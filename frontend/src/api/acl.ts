import { ACLService } from "@bindings/bridge";
import type { AccessPolicy, AccessPrincipal, AccessRule, AclVersionInfo } from "./models";
import { present, required } from "./client";

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

export type { AccessPrincipal, AccessRule, AccessPolicy };

/**
 * Whether the broker runs RocketMQ 5.3 authentication.
 *
 * This is what decides which of the two access-control systems the page can
 * show, so it is asked before anything else: 4.x plain_acl can be written and
 * never read, while the 5.3 store answers.
 */
export const getAclDirectoryEnabled = (connID: number): Promise<boolean> =>
  ACLService.DirectoryEnabled(connID);

export const getAclPrincipals = (connID: number): Promise<AccessPrincipal[]> =>
  ACLService.Principals(connID).then(present);

export const updateAclPrincipal = (
  connID: number,
  name: string,
  secret: string,
  type: string,
  status: string,
): Promise<void> => ACLService.UpdatePrincipal(connID, { name, secret, type, status });

export const deleteAclPrincipal = (connID: number, name: string): Promise<void> =>
  ACLService.DeletePrincipal(connID, name);

export const getAclRules = (connID: number): Promise<AccessRule[]> =>
  ACLService.Rules(connID).then(present);

/** Replaces every policy attached to the subject, which is what the broker does. */
export const updateAclRule = (
  connID: number,
  subject: string,
  description: string,
  policies: readonly {
    resource: string;
    actions: string[];
    effect: string;
    sourceIps: string[];
  }[],
): Promise<void> =>
  ACLService.UpdateRule(connID, { subject, description, policies: [...policies] });

export const deleteAclRule = (connID: number, subject: string): Promise<void> =>
  ACLService.DeleteRule(connID, subject);
