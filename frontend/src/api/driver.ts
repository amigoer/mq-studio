import { DriverService } from '@bindings/bridge'
import type { DriverInfo } from '@bindings/bridge/models'
import type { Capabilities, DriverDescriptor, MQKind } from '@bindings/model/models'
import { ACTIVE_CONNECTION } from './connectionScope'
import { required } from './client'

export type { Capabilities, DriverDescriptor, DriverInfo, MQKind }

/** The broker families a driver is compiled in for. */
export const listDrivers = (): Promise<DriverInfo[]> => DriverService.List()

/** A family's connection form and best-case capabilities, with nothing open. */
export const getDescriptor = (kind: MQKind): Promise<DriverDescriptor> =>
  DriverService.Descriptor(kind).then(required)

/** What one live connection can actually do. */
export const getCapabilities = (connID = ACTIVE_CONNECTION): Promise<Capabilities> =>
  DriverService.Capabilities(connID).then(required)
