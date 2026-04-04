import * as AclService from '../../bindings/rocket-leaf/internal/service/aclservice.js'
import type { AclVersionInfo } from '../../bindings/rocket-leaf/internal/model/models.js'

export type { AclVersionInfo }

export async function getAclEnabled(): Promise<boolean> {
  return await AclService.GetAclEnabled()
}

export async function getAclVersion(): Promise<AclVersionInfo | null> {
  return await AclService.GetAclVersion()
}

export async function createOrUpdateAccessConfig(
  accessKey: string,
  secretKey: string,
  whiteRemoteAddress: string,
  isAdmin: boolean,
  defaultTopicPerm: string,
  defaultGroupPerm: string,
  topicPerms: string[],
  groupPerms: string[]
): Promise<void> {
  await AclService.CreateOrUpdateAccessConfig(
    accessKey, secretKey, whiteRemoteAddress, isAdmin,
    defaultTopicPerm, defaultGroupPerm, topicPerms, groupPerms
  )
}

export async function deleteAccessConfig(accessKey: string): Promise<void> {
  await AclService.DeleteAccessConfig(accessKey)
}

export async function updateGlobalWhiteAddrs(addrs: string[]): Promise<void> {
  await AclService.UpdateGlobalWhiteAddrs(addrs)
}
