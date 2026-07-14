import type { AclVersionInfo } from '@generated/models'
import { callBackend } from './client'

export type { AclVersionInfo }
export async function getAclEnabled(): Promise<boolean> {
  return (await callBackend<{ enabled: boolean }>('acl.enabled')).enabled
}
export const getAclVersion = (): Promise<AclVersionInfo> => callBackend('acl.version')
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
  callBackend('acl.updateAccess', {
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
  callBackend('acl.deleteAccess', { accessKey })
export const updateGlobalWhiteAddrs = (addrs: string[]): Promise<void> =>
  callBackend('acl.updateWhiteAddrs', { addrs })
