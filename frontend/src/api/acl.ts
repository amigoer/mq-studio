import * as AclService from '../../bindings/rocket-leaf/internal/service/aclservice.js'
import type { AclUser, AclRule, AclPolicy } from '../../bindings/rocket-leaf/internal/model/models.js'

export type { AclUser, AclRule, AclPolicy }

export async function listUsers(): Promise<(AclUser | null)[]> {
  try {
    return await AclService.ListUsers()
  } catch (e) {
    console.error('ListUsers', e)
    throw e
  }
}

export async function createUser(username: string, password: string, userType: string): Promise<void> {
  try {
    await AclService.CreateUser(username, password, userType)
  } catch (e) {
    console.error('CreateUser', e)
    throw e
  }
}

export async function updateUser(
  username: string,
  password: string,
  userType: string,
  userStatus: string
): Promise<void> {
  try {
    await AclService.UpdateUser(username, password, userType, userStatus)
  } catch (e) {
    console.error('UpdateUser', e)
    throw e
  }
}

export async function deleteUser(username: string): Promise<void> {
  try {
    await AclService.DeleteUser(username)
  } catch (e) {
    console.error('DeleteUser', e)
    throw e
  }
}

export async function listAcls(): Promise<(AclRule | null)[]> {
  try {
    return await AclService.ListAcls()
  } catch (e) {
    console.error('ListAcls', e)
    throw e
  }
}

export async function createAcl(
  subject: string,
  policies: AclPolicy[],
  description: string
): Promise<void> {
  try {
    await AclService.CreateAcl(subject, policies, description)
  } catch (e) {
    console.error('CreateAcl', e)
    throw e
  }
}

export async function deleteAcl(subject: string): Promise<void> {
  try {
    await AclService.DeleteAcl(subject)
  } catch (e) {
    console.error('DeleteAcl', e)
    throw e
  }
}
