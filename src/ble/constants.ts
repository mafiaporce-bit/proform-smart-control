// Bluetooth details verified on this ProForm 105 CST with nRF Connect.

export const DEVICE_NAME = 'I_TL';

/** Proprietary iFit service: the only service this app talks to. */
export const IFIT_SERVICE = '00001533-1412-efde-1523-785feabcd123';
/** READ + WRITE. Host-to-treadmill channel. Written only by the guarded sendIfit() in Experimental iFit Telemetry Mode. */
export const CHAR_1534 = '00001534-1412-efde-1523-785feabcd123';
/** READ + NOTIFY. Treadmill-to-host channel. */
export const CHAR_1535 = '00001535-1412-efde-1523-785feabcd123';

/** Seen on the treadmill, purpose unknown. Listed for discovery only: never read or written. */
export const UNKNOWN_SERVICE = '00001400-555e-e99c-e511-f9f4f8daeb24';

/**
 * Firmware update service. Deliberately NOT requested anywhere in this app,
 * so the browser will refuse any access to it.
 */
export const DFU_SERVICE_NEVER_USED = '00001530-1212-efde-1523-785feabcd123';

export const shortUuid = (uuid: string) => uuid.slice(4, 8).toUpperCase();

/** The 1535 value read in nRF Connect, kept as a reference sample for the inspector. */
export const REFERENCE_CAPTURE_HEX =
  '68-FE-57-20-08-7F-7F-80-24-90-00-F2-EF-00-28-FE-FF-40-09-7E-FB-00-08-FF-FF-7F-EF-06-00-ED-DF-82-00-FF-FF-48-00-BF-FF-00-00-04-04-8F-FF-04-04-FF-FF-10-00-DB-BF-00-40-F7-FF-BD-FE-00-00-FF-BF-00-02-FF-FF-00-50-BA-FE-20-54-00';
