import { useSyncExternalStore } from 'react';
import { ble } from './manager';

export const useBle = () => useSyncExternalStore(ble.subscribe, ble.getState);
