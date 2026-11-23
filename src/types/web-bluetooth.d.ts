// Minimal Web Bluetooth typings for the calls this app makes.
interface BluetoothCharacteristicProperties {
  readonly broadcast: boolean;
  readonly read: boolean;
  readonly writeWithoutResponse: boolean;
  readonly write: boolean;
  readonly notify: boolean;
  readonly indicate: boolean;
}
interface BluetoothRemoteGATTCharacteristic extends EventTarget {
  readonly uuid: string;
  readonly properties: BluetoothCharacteristicProperties;
  readonly value?: DataView;
  readValue(): Promise<DataView>;
  writeValueWithResponse(value: BufferSource): Promise<void>;
  writeValueWithoutResponse(value: BufferSource): Promise<void>;
  startNotifications(): Promise<BluetoothRemoteGATTCharacteristic>;
  stopNotifications(): Promise<BluetoothRemoteGATTCharacteristic>;
}
interface BluetoothRemoteGATTService {
  readonly uuid: string;
  getCharacteristics(): Promise<BluetoothRemoteGATTCharacteristic[]>;
  getCharacteristic(uuid: string): Promise<BluetoothRemoteGATTCharacteristic>;
}
interface BluetoothRemoteGATTServer {
  readonly connected: boolean;
  connect(): Promise<BluetoothRemoteGATTServer>;
  disconnect(): void;
  getPrimaryService(uuid: string): Promise<BluetoothRemoteGATTService>;
}
interface BluetoothDevice extends EventTarget {
  readonly id: string;
  readonly name?: string;
  readonly gatt?: BluetoothRemoteGATTServer;
}
interface BluetoothRequestDeviceOptions {
  filters?: Array<{ name?: string; namePrefix?: string; services?: string[] }>;
  acceptAllDevices?: boolean;
  optionalServices?: string[];
}
interface Bluetooth {
  requestDevice(options: BluetoothRequestDeviceOptions): Promise<BluetoothDevice>;
  getAvailability?(): Promise<boolean>;
}
interface Navigator {
  readonly bluetooth?: Bluetooth;
}
