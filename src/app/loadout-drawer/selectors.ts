import {
  Loadout as DimApiLoadout,
  LoadoutItem as DimApiLoadoutItem,
} from '@destinyitemmanager/dim-api-types';
import { currentProfileSelector } from 'app/dim-api/selectors';
import { RootState } from 'app/store/types';
import { emptyArray } from 'app/utils/empty';
import _ from 'lodash';
import { createSelector } from 'reselect';
import { Loadout, LoadoutItem } from './loadout-types';

/** All loadouts relevant to the current account */
export const loadoutsSelector = createSelector(currentProfileSelector, (profile) =>
  profile
    ? Object.values(profile.loadouts).map((loadout) => convertDimApiLoadoutToLoadout(loadout))
    : emptyArray<Loadout>()
);
export const previousLoadoutSelector = (state: RootState, storeId: string): Loadout | undefined => {
  if (state.loadouts.previousLoadouts[storeId]) {
    return _.last(state.loadouts.previousLoadouts[storeId]);
  }
  return undefined;
};

/**
 * DIM API stores loadouts in a new format, but the app still uses the old format everywhere. This converts the API
 * storage format to the old loadout format.
 */
function convertDimApiLoadoutToLoadout(loadout: DimApiLoadout): Loadout {
  return {
    id: loadout.id,
    classType: loadout.classType,
    name: loadout.name,
    clearSpace: loadout.clearSpace || false,
    items: [
      ...loadout.equipped.map((i) => convertDimApiLoadoutItemToLoadoutItem(i, true)),
      ...loadout.unequipped.map((i) => convertDimApiLoadoutItemToLoadoutItem(i, false)),
    ],
    parameters: loadout.parameters,
  };
}

/**
 * Converts DimApiLoadoutItem to real loadout items.
 */
export function convertDimApiLoadoutItemToLoadoutItem(
  item: DimApiLoadoutItem,
  equipped: boolean
): LoadoutItem {
  return {
    id: item.id || '0',
    hash: item.hash,
    amount: item.amount || 1,
    equipped,
  };
}
