import { ACLService } from '@bindings/bridge'
import type { AclVersionInfo } from './models'
import { required } from './client'

export type { AclVersionInfo }

export const getAclEnabled = (): Promise<boolean> => ACLService.Enabled()
export const getAclVersion = (): Promise<AclVersionInfo> => ACLService.Version().then(required)
export const createOrUpdateAccessConfig = (
  accessKey: string,
  secretKey: string,
  whiteRemoteAddress: string,
  isAdmin: boolean,
  defaultTopicPerm: string,
  defaultGroupPerm: string,
  topicPerms: string[],
  groupPerms: string[],
): Promise<void> =>
  ACLService.UpdateAccess({
    accessKey,
    secretKey,
    whiteRemoteAddress,
    isAdmin,
    defaultTopicPerm,
    defaultGroupPerm,
    topicPerms,
    groupPerms,
  })
export const deleteAccessConfig = (accessKey: string): Promise<void> =>
  ACLService.DeleteAccess(accessKey)
export const updateGlobalWhiteAddrs = (addrs: string[]): Promise<void> =>
  ACLService.UpdateWhiteAddrs(addrs)
