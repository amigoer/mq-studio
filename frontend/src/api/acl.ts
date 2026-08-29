import { ACLService } from "@bindings/bridge";
import type { AclVersionInfo } from "./models";
import { required } from "./client";

export type { AclVersionInfo };

export const getAclEnabled = (connID: number): Promise<boolean> =>
  ACLService.Enabled(connID);
export const getAclVersion = (connID: number): Promise<AclVersionInfo> =>
  ACLService.Version(connID).then(required);
export const createOrUpdateAccessConfig = (
  connID: number,
  accessKey: string,
  secretKey: string,
  whiteRemoteAddress: string,
  isAdmin: boolean,
  defaultTopicPerm: string,
  defaultGroupPerm: string,
  topicPerms: string[],
  groupPerms: string[],
): Promise<void> =>
  ACLService.UpdateAccess(connID, {
    accessKey,
    secretKey,
    whiteRemoteAddress,
    isAdmin,
    defaultTopicPerm,
    defaultGroupPerm,
    topicPerms,
    groupPerms,
  });
export const deleteAccessConfig = (connID: number, accessKey: string): Promise<void> =>
  ACLService.DeleteAccess(connID, accessKey);
export const updateGlobalWhiteAddrs = (connID: number, addrs: string[]): Promise<void> =>
  ACLService.UpdateWhiteAddrs(connID, addrs);
