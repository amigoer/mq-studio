import { useState, useCallback, useEffect } from 'react'
import { toast } from 'sonner'
import {
  RefreshCw,
  Search,
  X,
  Trash2,
  Loader2,
  AlertTriangle,
  Plus,
  Shield,
  Users,
  ChevronDown,
  ShieldCheck,
  ShieldX,
} from 'lucide-react'
import { cn, formatErrorMessage } from '@/lib/utils'
import * as aclApi from '@/api/acl'
import type { AclUser, AclRule, AclPolicy } from '@/api/acl'

const MIN_SPIN_MS = 400

type TabId = 'users' | 'rules'

export function AclView() {
  // Tab state
  const [activeTab, setActiveTab] = useState<TabId>('users')

  // Users state
  const [users, setUsers] = useState<AclUser[]>([])
  const [usersLoading, setUsersLoading] = useState(false)
  const [usersError, setUsersError] = useState<string | null>(null)

  // Rules state
  const [rules, setRules] = useState<AclRule[]>([])
  const [rulesLoading, setRulesLoading] = useState(false)
  const [rulesError, setRulesError] = useState<string | null>(null)

  // Search
  const [search, setSearch] = useState('')

  // Create user dialog
  const [showCreateUser, setShowCreateUser] = useState(false)
  const [newUsername, setNewUsername] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [newUserType, setNewUserType] = useState('Normal')
  const [creating, setCreating] = useState(false)

  // Create rule dialog
  const [showCreateRule, setShowCreateRule] = useState(false)
  const [newSubject, setNewSubject] = useState('')
  const [newDescription, setNewDescription] = useState('')
  const [newPolicies, setNewPolicies] = useState<AclPolicy[]>([])
  const [creatingRule, setCreatingRule] = useState(false)

  // Delete state
  const [deletingUser, setDeletingUser] = useState<string | null>(null)
  const [deletingRule, setDeletingRule] = useState<string | null>(null)

  // Expanded rule detail
  const [expandedRule, setExpandedRule] = useState<string | null>(null)

  // Refreshing
  const [refreshing, setRefreshing] = useState(false)

  const loadUsers = useCallback(async () => {
    setUsersLoading(true)
    setUsersError(null)
    try {
      const result = await aclApi.listUsers()
      setUsers(result.filter((u): u is AclUser => u !== null))
    } catch (e) {
      setUsersError(formatErrorMessage(e))
    } finally {
      setUsersLoading(false)
    }
  }, [])

  const loadRules = useCallback(async () => {
    setRulesLoading(true)
    setRulesError(null)
    try {
      const result = await aclApi.listAcls()
      setRules(result.filter((r): r is AclRule => r !== null))
    } catch (e) {
      setRulesError(formatErrorMessage(e))
    } finally {
      setRulesLoading(false)
    }
  }, [])

  useEffect(() => {
    loadUsers()
    loadRules()
  }, [loadUsers, loadRules])

  const handleRefresh = useCallback(async () => {
    setRefreshing(true)
    const start = Date.now()
    try {
      await Promise.all([loadUsers(), loadRules()])
    } finally {
      const elapsed = Date.now() - start
      if (elapsed < MIN_SPIN_MS) {
        setTimeout(() => setRefreshing(false), MIN_SPIN_MS - elapsed)
      } else {
        setRefreshing(false)
      }
    }
  }, [loadUsers, loadRules])

  const handleCreateUser = useCallback(async () => {
    if (!newUsername.trim() || !newPassword.trim()) {
      toast.error('请输入用户名和密码')
      return
    }
    setCreating(true)
    try {
      await aclApi.createUser(newUsername.trim(), newPassword.trim(), newUserType)
      toast.success(`用户 ${newUsername} 创建成功`)
      setShowCreateUser(false)
      setNewUsername('')
      setNewPassword('')
      setNewUserType('Normal')
      await loadUsers()
    } catch (e) {
      toast.error(formatErrorMessage(e))
    } finally {
      setCreating(false)
    }
  }, [newUsername, newPassword, newUserType, loadUsers])

  const handleDeleteUser = useCallback(async (username: string) => {
    setDeletingUser(username)
    try {
      await aclApi.deleteUser(username)
      toast.success(`用户 ${username} 已删除`)
      await loadUsers()
    } catch (e) {
      toast.error(formatErrorMessage(e))
    } finally {
      setDeletingUser(null)
    }
  }, [loadUsers])

  const handleCreateRule = useCallback(async () => {
    if (!newSubject.trim()) {
      toast.error('请输入主体（用户名）')
      return
    }
    setCreatingRule(true)
    try {
      await aclApi.createAcl(newSubject.trim(), newPolicies, newDescription.trim())
      toast.success(`ACL 规则创建成功`)
      setShowCreateRule(false)
      setNewSubject('')
      setNewDescription('')
      setNewPolicies([])
      await loadRules()
    } catch (e) {
      toast.error(formatErrorMessage(e))
    } finally {
      setCreatingRule(false)
    }
  }, [newSubject, newPolicies, newDescription, loadRules])

  const handleDeleteRule = useCallback(async (subject: string) => {
    setDeletingRule(subject)
    try {
      await aclApi.deleteAcl(subject)
      toast.success(`ACL 规则已删除`)
      await loadRules()
    } catch (e) {
      toast.error(formatErrorMessage(e))
    } finally {
      setDeletingRule(null)
    }
  }, [loadRules])

  const addPolicy = useCallback(() => {
    setNewPolicies((prev) => [
      ...prev,
      { resource: '', actions: ['PUB'], effect: 'ALLOW', sourceIps: [], decision: '' } as unknown as AclPolicy,
    ])
  }, [])

  const removePolicy = useCallback((index: number) => {
    setNewPolicies((prev) => prev.filter((_, i) => i !== index))
  }, [])

  const updatePolicy = useCallback((index: number, field: string, value: string | string[]) => {
    setNewPolicies((prev) =>
      prev.map((p, i) => (i === index ? { ...p, [field]: value } : p))
    )
  }, [])

  const filteredUsers = search
    ? users.filter((u) => u.username.toLowerCase().includes(search.toLowerCase()))
    : users

  const filteredRules = search
    ? rules.filter(
        (r) =>
          r.subject.toLowerCase().includes(search.toLowerCase()) ||
          r.description.toLowerCase().includes(search.toLowerCase())
      )
    : rules

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-border/40 px-6 py-4">
        <Shield className="h-5 w-5 text-primary" />
        <h1 className="text-lg font-semibold">ACL 管理</h1>
        <div className="flex-1" />
        <button
          type="button"
          onClick={handleRefresh}
          disabled={refreshing}
          className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"
          aria-label="刷新"
        >
          <RefreshCw className={cn('h-4 w-4', refreshing && 'animate-spin')} />
        </button>
      </div>

      {/* Tabs + Search */}
      <div className="flex items-center gap-3 border-b border-border/40 px-6 py-2">
        <div className="flex gap-1">
          <button
            type="button"
            onClick={() => setActiveTab('users')}
            className={cn(
              'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
              activeTab === 'users'
                ? 'bg-primary/10 text-primary'
                : 'text-muted-foreground hover:bg-accent hover:text-foreground'
            )}
          >
            <Users className="h-3.5 w-3.5" />
            用户 ({users.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('rules')}
            className={cn(
              'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
              activeTab === 'rules'
                ? 'bg-primary/10 text-primary'
                : 'text-muted-foreground hover:bg-accent hover:text-foreground'
            )}
          >
            <ShieldCheck className="h-3.5 w-3.5" />
            规则 ({rules.length})
          </button>
        </div>
        <div className="flex-1" />
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            placeholder="搜索..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-8 w-48 rounded-md border border-input bg-background pl-8 pr-8 text-sm outline-none focus:ring-1 focus:ring-ring"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        <button
          type="button"
          onClick={() => (activeTab === 'users' ? setShowCreateUser(true) : setShowCreateRule(true))}
          className="flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          <Plus className="h-3.5 w-3.5" />
          {activeTab === 'users' ? '创建用户' : '创建规则'}
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        {activeTab === 'users' ? (
          <UsersTab
            users={filteredUsers}
            loading={usersLoading}
            error={usersError}
            deletingUser={deletingUser}
            onDelete={handleDeleteUser}
            onRetry={loadUsers}
          />
        ) : (
          <RulesTab
            rules={filteredRules}
            loading={rulesLoading}
            error={rulesError}
            deletingRule={deletingRule}
            expandedRule={expandedRule}
            onToggleExpand={(subject) =>
              setExpandedRule((prev) => (prev === subject ? null : subject))
            }
            onDelete={handleDeleteRule}
            onRetry={loadRules}
          />
        )}
      </div>

      {/* Create User Dialog */}
      {showCreateUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-[420px] rounded-lg border border-border bg-card p-6 shadow-xl">
            <h2 className="mb-4 text-base font-semibold">创建用户</h2>
            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-sm text-muted-foreground">用户名</label>
                <input
                  type="text"
                  value={newUsername}
                  onChange={(e) => setNewUsername(e.target.value)}
                  placeholder="username"
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-1 focus:ring-ring"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm text-muted-foreground">密码</label>
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="password"
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-1 focus:ring-ring"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm text-muted-foreground">用户类型</label>
                <select
                  value={newUserType}
                  onChange={(e) => setNewUserType(e.target.value)}
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-1 focus:ring-ring"
                >
                  <option value="Normal">Normal</option>
                  <option value="Super">Super</option>
                </select>
              </div>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setShowCreateUser(false)
                  setNewUsername('')
                  setNewPassword('')
                  setNewUserType('Normal')
                }}
                className="h-9 rounded-md border border-input px-4 text-sm hover:bg-accent"
              >
                取消
              </button>
              <button
                type="button"
                onClick={handleCreateUser}
                disabled={creating || !newUsername.trim() || !newPassword.trim()}
                className="flex h-9 items-center gap-1.5 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                {creating && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                创建
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Create Rule Dialog */}
      {showCreateRule && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-[560px] max-h-[80vh] overflow-y-auto rounded-lg border border-border bg-card p-6 shadow-xl">
            <h2 className="mb-4 text-base font-semibold">创建 ACL 规则</h2>
            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-sm text-muted-foreground">主体（用户名）</label>
                <input
                  type="text"
                  value={newSubject}
                  onChange={(e) => setNewSubject(e.target.value)}
                  placeholder="username"
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-1 focus:ring-ring"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm text-muted-foreground">描述</label>
                <input
                  type="text"
                  value={newDescription}
                  onChange={(e) => setNewDescription(e.target.value)}
                  placeholder="可选描述"
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-1 focus:ring-ring"
                />
              </div>
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <label className="text-sm text-muted-foreground">策略列表</label>
                  <button
                    type="button"
                    onClick={addPolicy}
                    className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-primary hover:bg-primary/10"
                  >
                    <Plus className="h-3 w-3" /> 添加策略
                  </button>
                </div>
                {newPolicies.length === 0 && (
                  <p className="text-sm text-muted-foreground">暂无策略，点击添加</p>
                )}
                {newPolicies.map((policy, index) => (
                  <div key={index} className="mb-2 rounded-md border border-border/60 p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium text-muted-foreground">策略 #{index + 1}</span>
                      <button
                        type="button"
                        onClick={() => removePolicy(index)}
                        className="text-destructive hover:text-destructive/80"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="mb-0.5 block text-xs text-muted-foreground">资源</label>
                        <input
                          type="text"
                          value={policy.resource}
                          onChange={(e) => updatePolicy(index, 'resource', e.target.value)}
                          placeholder="Topic:* 或 Group:*"
                          className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs outline-none focus:ring-1 focus:ring-ring"
                        />
                      </div>
                      <div>
                        <label className="mb-0.5 block text-xs text-muted-foreground">效果</label>
                        <select
                          value={policy.effect}
                          onChange={(e) => updatePolicy(index, 'effect', e.target.value)}
                          className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs outline-none focus:ring-1 focus:ring-ring"
                        >
                          <option value="ALLOW">ALLOW</option>
                          <option value="DENY">DENY</option>
                        </select>
                      </div>
                    </div>
                    <div>
                      <label className="mb-0.5 block text-xs text-muted-foreground">操作（多选）</label>
                      <div className="flex gap-3">
                        {['PUB', 'SUB', 'ANY'].map((action) => (
                          <label key={action} className="flex items-center gap-1 text-xs">
                            <input
                              type="checkbox"
                              checked={(policy.actions || []).includes(action)}
                              onChange={(e) => {
                                const current = policy.actions || []
                                const next = e.target.checked
                                  ? [...current, action]
                                  : current.filter((a: string) => a !== action)
                                updatePolicy(index, 'actions', next)
                              }}
                              className="rounded"
                            />
                            {action}
                          </label>
                        ))}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setShowCreateRule(false)
                  setNewSubject('')
                  setNewDescription('')
                  setNewPolicies([])
                }}
                className="h-9 rounded-md border border-input px-4 text-sm hover:bg-accent"
              >
                取消
              </button>
              <button
                type="button"
                onClick={handleCreateRule}
                disabled={creatingRule || !newSubject.trim()}
                className="flex h-9 items-center gap-1.5 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                {creatingRule && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                创建
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/* ---------- Users tab ---------- */

function UsersTab({
  users,
  loading,
  error,
  deletingUser,
  onDelete,
  onRetry,
}: {
  users: AclUser[]
  loading: boolean
  error: string | null
  deletingUser: string | null
  onDelete: (username: string) => void
  onRetry: () => void
}) {
  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin" />
        <span className="mt-2 text-sm">加载中...</span>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <AlertTriangle className="h-6 w-6 text-destructive" />
        <p className="mt-2 text-sm text-destructive">{error}</p>
        <button
          type="button"
          onClick={onRetry}
          className="mt-3 rounded-md border border-input px-3 py-1.5 text-sm hover:bg-accent"
        >
          重试
        </button>
      </div>
    )
  }

  if (users.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
        <Users className="h-8 w-8 opacity-40" />
        <p className="mt-2 text-sm">暂无 ACL 用户</p>
      </div>
    )
  }

  return (
    <div className="overflow-hidden rounded-lg border border-border/60">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border/40 bg-muted/30">
            <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">用户名</th>
            <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">类型</th>
            <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">状态</th>
            <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">权限</th>
            <th className="w-16 px-4 py-2.5 text-center font-medium text-muted-foreground">操作</th>
          </tr>
        </thead>
        <tbody>
          {users.map((user) => (
            <tr
              key={user.username}
              className="border-b border-border/20 last:border-b-0 hover:bg-muted/20 transition-colors"
            >
              <td className="px-4 py-2.5 font-mono text-xs">{user.username}</td>
              <td className="px-4 py-2.5">
                <span
                  className={cn(
                    'inline-flex rounded-full px-2 py-0.5 text-xs font-medium',
                    user.userType === 'Super'
                      ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
                      : 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
                  )}
                >
                  {user.userType || 'Normal'}
                </span>
              </td>
              <td className="px-4 py-2.5">
                <span
                  className={cn(
                    'inline-flex items-center gap-1 text-xs',
                    user.userStatus === 'Active' || !user.userStatus
                      ? 'text-emerald-600 dark:text-emerald-400'
                      : 'text-red-600 dark:text-red-400'
                  )}
                >
                  <span
                    className={cn(
                      'inline-block h-1.5 w-1.5 rounded-full',
                      user.userStatus === 'Active' || !user.userStatus ? 'bg-emerald-500' : 'bg-red-500'
                    )}
                  />
                  {user.userStatus || 'Active'}
                </span>
              </td>
              <td className="px-4 py-2.5 text-xs text-muted-foreground">
                {user.permissions && user.permissions.length > 0
                  ? user.permissions.join(', ')
                  : '-'}
              </td>
              <td className="px-4 py-2.5 text-center">
                <button
                  type="button"
                  onClick={() => onDelete(user.username)}
                  disabled={deletingUser === user.username}
                  className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
                  title="删除用户"
                >
                  {deletingUser === user.username ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Trash2 className="h-3.5 w-3.5" />
                  )}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/* ---------- Rules tab ---------- */

function RulesTab({
  rules,
  loading,
  error,
  deletingRule,
  expandedRule,
  onToggleExpand,
  onDelete,
  onRetry,
}: {
  rules: AclRule[]
  loading: boolean
  error: string | null
  deletingRule: string | null
  expandedRule: string | null
  onToggleExpand: (subject: string) => void
  onDelete: (subject: string) => void
  onRetry: () => void
}) {
  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin" />
        <span className="mt-2 text-sm">加载中...</span>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <AlertTriangle className="h-6 w-6 text-destructive" />
        <p className="mt-2 text-sm text-destructive">{error}</p>
        <button
          type="button"
          onClick={onRetry}
          className="mt-3 rounded-md border border-input px-3 py-1.5 text-sm hover:bg-accent"
        >
          重试
        </button>
      </div>
    )
  }

  if (rules.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
        <ShieldX className="h-8 w-8 opacity-40" />
        <p className="mt-2 text-sm">暂无 ACL 规则</p>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {rules.map((rule) => {
        const isExpanded = expandedRule === rule.subject
        return (
          <div
            key={rule.subject}
            className="rounded-lg border border-border/60 overflow-hidden"
          >
            <div
              className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-muted/20 transition-colors"
              onClick={() => onToggleExpand(rule.subject)}
            >
              <ChevronDown
                className={cn(
                  'h-4 w-4 text-muted-foreground transition-transform',
                  isExpanded && 'rotate-180'
                )}
              />
              <Shield className="h-4 w-4 text-primary" />
              <span className="font-mono text-sm font-medium">{rule.subject}</span>
              {rule.description && (
                <span className="text-xs text-muted-foreground">— {rule.description}</span>
              )}
              <span className="ml-auto text-xs text-muted-foreground">
                {rule.policies?.length || 0} 条策略
              </span>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  onDelete(rule.subject)
                }}
                disabled={deletingRule === rule.subject}
                className="ml-2 inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
                title="删除规则"
              >
                {deletingRule === rule.subject ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Trash2 className="h-3.5 w-3.5" />
                )}
              </button>
            </div>
            {isExpanded && rule.policies && rule.policies.length > 0 && (
              <div className="border-t border-border/40 bg-muted/10 px-4 py-3">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-muted-foreground">
                      <th className="pb-1.5 text-left font-medium">资源</th>
                      <th className="pb-1.5 text-left font-medium">操作</th>
                      <th className="pb-1.5 text-left font-medium">效果</th>
                      <th className="pb-1.5 text-left font-medium">来源 IP</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rule.policies.map((policy, idx) => (
                      <tr key={idx} className="border-t border-border/20">
                        <td className="py-1.5 font-mono">{policy.resource || '*'}</td>
                        <td className="py-1.5">
                          <div className="flex gap-1">
                            {(policy.actions || []).map((action: string) => (
                              <span
                                key={action}
                                className="rounded bg-primary/10 px-1.5 py-0.5 text-primary"
                              >
                                {action}
                              </span>
                            ))}
                          </div>
                        </td>
                        <td className="py-1.5">
                          <span
                            className={cn(
                              'inline-flex rounded-full px-2 py-0.5 font-medium',
                              policy.effect === 'ALLOW'
                                ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
                                : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                            )}
                          >
                            {policy.effect}
                          </span>
                        </td>
                        <td className="py-1.5 text-muted-foreground">
                          {policy.sourceIps && policy.sourceIps.length > 0
                            ? policy.sourceIps.join(', ')
                            : '*'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
