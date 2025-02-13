import { currentAccountSelector } from 'app/accounts/selectors';
import { t } from 'app/i18next-t';
import { d2ManifestSelector } from 'app/manifest/selectors';
import { ThunkResult } from 'app/store/types';
import { DimError } from 'app/utils/dim-error';
import { errorLog } from 'app/utils/log';
import {
  AwaAuthorizationResult,
  AwaType,
  AwaUserSelection,
  DestinyItemChangeResponse,
  DestinySocketArrayType,
  insertSocketPlug,
} from 'bungie-api-ts/destiny2';
import { get, set } from 'idb-keyval';
import { DestinyAccount } from '../accounts/destiny-account';
import { authenticatedHttpClient } from '../bungie-api/bungie-service-helper';
import { getSingleItem, requestAdvancedWriteActionToken } from '../bungie-api/destiny2-api';
import { showNotification } from '../notifications/notifications';
import { awaItemChanged } from './actions';
import { DimItem, DimSocket } from './item-types';
import { bucketsSelector, currentStoreSelector } from './selectors';

let awaCache: {
  [key: number]: AwaAuthorizationResult & { used: number };
};

export function insertPlug(item: DimItem, socket: DimSocket, plugItemHash: number): ThunkResult {
  return async (dispatch, getState) => {
    const account = currentAccountSelector(getState())!;

    // The API requires either the ID of the character that owns the item, or
    // the current character ID if the item is in the vault.
    const storeId = item.owner === 'vault' ? currentStoreSelector(getState())!.id : item.owner;
    try {
      const actionToken = await getAwaToken(account, AwaType.InsertPlugs, storeId, item);
      // TODO: if the plug costs resources to insert, add a confirmation. This'd
      // be a great place for a dialog component?

      const response = await insertSocketPlug(authenticatedHttpClient, {
        actionToken,
        itemInstanceId: item.id,
        plug: {
          socketIndex: socket.socketIndex,
          socketArrayType: DestinySocketArrayType.Default,
          plugItemHash,
        },
        characterId: storeId,
        membershipType: account.originalPlatformType,
      });

      // Update items that changed
      await dispatch(refreshItemAfterAWA(item, response.Response));
    } catch (e) {
      errorLog('AWA', "Couldn't insert plug", item, e);
      showNotification({ type: 'error', title: t('AWA.Error'), body: e.message });
    }
  };
}

/**
 * Updating items is supposed to return the new item... but sometimes it comes back weird. Instead we'll just load the item.
 */
function refreshItemAfterAWA(item: DimItem, changes: DestinyItemChangeResponse): ThunkResult {
  return async (dispatch, getState) => {
    // Update items that changed
    // TODO: reload item instead
    const account = currentAccountSelector(getState())!;
    try {
      const itemInfo = await getSingleItem(item.id, account);
      changes = { ...changes, item: itemInfo };
    } catch (e) {
      errorLog('AWA', 'Unable to refresh item, falling back on AWA response', item, e);
    }

    dispatch(
      awaItemChanged({
        changes,
        defs: d2ManifestSelector(getState())!,
        buckets: bucketsSelector(getState())!,
      })
    );
  };
}

/**
 * Given a request for an action token, and a particular action type, return either
 * a cached token or fetch and return a new one.
 *
 * Note: Error/success messaging must be handled by callers, but this will pop up a prompt to go to the app and grant permissions.
 *
 * @param item The item is optional unless the type is DismantleGroupA, but it's best to pass it when possible.
 */
export async function getAwaToken(
  account: DestinyAccount,
  action: AwaType,
  storeId: string,
  item?: DimItem
): Promise<string> {
  if (!awaCache) {
    // load from cache first time
    // TODO: maybe put this in Redux!
    awaCache = (await get('awa-tokens')) || {};
  }

  let info = awaCache[action];
  if (!info || !tokenValid(info)) {
    try {
      // Note: Error messages should be handled by other components. This is just to tell them to check the app.
      showNotification({
        type: 'info',
        title: t('AWA.ConfirmTitle'),
        body: t('AWA.ConfirmDescription'),
      });

      // TODO: Do we need to cache a token per item?
      info = awaCache[action] = {
        ...(await requestAdvancedWriteActionToken(account, action, storeId, item)),
        used: 0,
      };

      // Deletes of "group A" require an item and shouldn't be cached
      // TODO: This got removed from the API
      /*
      if (action === AwaType.DismantleGroupA) {
        delete awaCache[action]; // don't cache
      }
      */
    } catch (e) {
      throw new DimError('AWA.FailedToken').withError(e);

      // TODO: handle userSelection, responseReason (TimedOut, Replaced)
    }

    if (!info || !tokenValid(info)) {
      throw new DimError('AWA.FailedToken', info ? info.developerNote : 'no response');
    }
  }

  info.used++;

  // TODO: really should use a separate db for this
  await set('awa-tokens', awaCache);

  return info.actionToken;
}

function tokenValid(info: AwaAuthorizationResult & { used: number }) {
  return (
    (!info.validUntil || new Date(info.validUntil) > new Date()) &&
    (info.maximumNumberOfUses === 0 || info.used <= info.maximumNumberOfUses) &&
    info.userSelection === AwaUserSelection.Approved
  );
}
