import { useState, useCallback, useEffect } from 'react'
import { toast } from 'sonner'
import {
  RefreshCw,
  Trash2,
  Loader2,
  AlertTriangle,
  Plus,
  Shield,
  ShieldOff,
  Info,
} from 'lucide-react'
import { cn, formatErrorMessage } from '@/lib/utils'
import * as aclApi from '@/api/acl'
import type { AclVersionInfo } from '@/api/acl'

const MIN_SPIN_MS = 400

const PERM_OPTIONS = [
  { value: 'DENY', label: 'DENY' },
  { value: 'PUB', label: 'PUB' },
  { value: 'SUB', label: 'SUB' },
  { value: 'PUB|SUB', label: 'PUB|SUB' },
]

export function AclView() {
  const [aclEnabled, setAclEnabled] = useState<boolean | null>(null)
  const [aclVersion, setAclVersion] = useState<AclVersionInfo | null>(null)
  const [statusLoading, setStatusLoading] = useState(true)
  const [statusError, setStatusError] = useState<string | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  // Create/Update dialog
  const [showForm, setShowForm] = useState(false)
  const [formAccessKey, setFormAccessKey] = useState('')
  const [formSecretKey, setFormSecretKey] = useState('')
  const [formWhiteAddr, setFormWhiteAddr] = useState('')
  const [formIsAdmin, setFormIsAdmin] = useState(false)
  const [formDefaultTopicPerm, setFormDefaultTopicPerm] = useState('DENY')
  const [formDefaultGroupPerm, setFormDefaultGroupPerm] = useState('SUB')
  const [formTopicPerms, setFormTopicPerms] = useState('')
  const [formGroupPerms, setFormGroupPerms] = useState('')
  const [saving, setSaving] = useState(false)

  // Delete dialog
  const [showDelete, setShowDelete] = useState(false)
  const [deleteAccessKey, setDeleteAccessKey] = useState('')
  const [deleting, setDeleting] = useState(false)

  const loadStatus = useCallback(async () => {
    setStatusLoading(true)
    setStatusError(null)
    try {
      const [enabled, version] = await Promise.all([
        aclApi.getAclEnabled(),
        aclApi.getAclVersion().catch(() => null),
      ])
      setAclEnabled(enabled)
      setAclVersion(version)
    } catch (e) {
      setStatusError(formatErrorMessage(e))
    } finally {
      setStatusLoading(false)
    }
  }, [])

  useEffect(() => {
    loadStatus()
  }, [loadStatus])

  const handleRefresh = useCallback(async () => {
    setRefreshing(true)
    const start = Date.now()
    try {
      await loadStatus()
    } finally {
      const elapsed = Date.now() - start
      if (elapsed < MIN_SPIN_MS) {
        setTimeout(() => setRefreshing(false), MIN_SPIN_MS - elapsed)
      } else {
        setRefreshing(false)
      }
    }
  }, [loadStatus])

  const resetForm = useCallback(() => {
    setFormAccessKey('')
    setFormSecretKey('')
    setFormWhiteAddr('')
    setFormIsAdmin(false)
    setFormDefaultTopicPerm('DENY')
    setFormDefaultGroupPerm('SUB')
    setFormTopicPerms('')
    setFormGroupPerms('')
  }, [])

  const handleSave = useCallback(async () => {
    if (!formAccessKey.trim()) {
      toast.error('请输入 AccessKey')
      return
    }
    if (!formSecretKey.trim()) {
      toast.error('请输入 SecretKey')
      return
    }
    setSaving(true)
    try {
      const topicPerms = formTopicPerms.trim()
        ? formTopicPerms.split('\n').map((s) => s.trim()).filter(Boolean)
        : []
      const groupPerms = formGroupPerms.trim()
        ? formGroupPerms.split('\n').map((s) => s.trim()).filter(Boolean)
        : []

      await aclApi.createOrUpdateAccessConfig(
        formAccessKey.trim(),
        formSecretKey.trim(),
        formWhiteAddr.trim(),
        formIsAdmin,
        formDefaultTopicPerm,
        formDefaultGroupPerm,
        topicPerms,
        groupPerms
      )
      toast.success('ACL 配置已保存')
      setShowForm(false)
      resetForm()
      await loadStatus()
    } catch (e) {
      toast.error(formatErrorMessage(e))
    } finally {
      setSaving(false)
    }
  }, [
    formAccessKey, formSecretKey, formWhiteAddr, formIsAdmin,
    formDefaultTopicPerm, formDefaultGroupPerm, formTopicPerms, formGroupPerms,
    resetForm, loadStatus,
  ])

  const handleDelete = useCallback(async () => {
    if (!deleteAccessKey.trim()) {
      toast.error('请输入要删除的 AccessKey')
      return
    }
    setDeleting(true)
    try {
      await aclApi.deleteAccessConfig(deleteAccessKey.trim())
      toast.success(`AccessKey "${deleteAccessKey}" 已删除`)
      setShowDelete(false)
      setDeleteAccessKey('')
      await loadStatus()
    } catch (e) {
      toast.error(formatErrorMessage(e))
    } finally {
      setDeleting(false)
    }
  }, [deleteAccessKey, loadStatus])

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

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        {statusLoading ? (
          <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
            <Loader2 className="h-6 w-6 animate-spin" />
            <span className="mt-2 text-sm">加载中...</span>
          </div>
        ) : statusError ? (
          <div className="flex flex-col items-center justify-center py-20">
            <AlertTriangle className="h-6 w-6 text-destructive" />
            <p className="mt-2 text-sm text-destructive">{statusError}</p>
            <button
              type="button"
              onClick={loadStatus}
              className="mt-3 rounded-md border border-input px-3 py-1.5 text-sm hover:bg-accent"
            >
              重试
            </button>
          </div>
        ) : (
          <div className="mx-auto max-w-2xl space-y-6">
            {/* ACL Status Card */}
            <div className="rounded-lg border border-border/60 p-5">
              <div className="flex items-center gap-3 mb-4">
                {aclEnabled ? (
                  <Shield className="h-5 w-5 text-emerald-500" />
                ) : (
                  <ShieldOff className="h-5 w-5 text-muted-foreground" />
                )}
                <span className="text-base font-medium">
                  ACL {aclEnabled ? '已启用' : '未启用'}
                </span>
                <span
                  className={cn(
                    'inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium',
                    aclEnabled
                      ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
                      : 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400'
                  )}
                >
                  {aclEnabled ? 'Enabled' : 'Disabled'}
                </span>
              </div>
              {aclVersion && (
                <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
                  <div>
                    <span className="text-muted-foreground">Broker: </span>
                    <span className="font-mono text-xs">{aclVersion.brokerName || '-'}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Address: </span>
                    <span className="font-mono text-xs">{aclVersion.brokerAddr || '-'}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Cluster: </span>
                    <span className="font-mono text-xs">{aclVersion.clusterName || '-'}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Version: </span>
                    <span className="font-mono text-xs">{aclVersion.version || '-'}</span>
                  </div>
                </div>
              )}

              {!aclEnabled && (
                <div className="mt-4 flex items-start gap-2 rounded-md bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-900/20 dark:text-amber-300">
                  <Info className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>
                    Broker 未启用 ACL。需在 broker.conf 中设置 <code className="rounded bg-amber-100 px-1 dark:bg-amber-900/40">aclEnable=true</code> 并重启 Broker 后才能使用 ACL 功能。
                  </span>
                </div>
              )}
            </div>

            {/* Action Buttons */}
            {aclEnabled && (
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setShowForm(true)}
                  className="flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
                >
                  <Plus className="h-3.5 w-3.5" />
                  创建 / 更新访问配置
                </button>
                <button
                  type="button"
                  onClick={() => setShowDelete(true)}
                  className="flex items-center gap-1.5 rounded-md border border-destructive/30 px-4 py-2 text-sm font-medium text-destructive hover:bg-destructive/10"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  删除访问配置
                </button>
              </div>
            )}

            {/* Info about old ACL */}
            {aclEnabled && (
              <div className="flex items-start gap-2 rounded-md border border-border/40 bg-muted/30 p-4 text-sm text-muted-foreground">
                <Info className="mt-0.5 h-4 w-4 shrink-0" />
                <span>
                  当前使用 RocketMQ 4.x 旧版 ACL（基于 plain_acl.yml）。该模式下 Broker 不提供列出所有访问配置的远程 API，
                  只能通过创建/更新和删除操作管理 AccessKey。请确保您知道要操作的 AccessKey。
                </span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Create/Update Dialog */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-[520px] max-h-[85vh] overflow-y-auto rounded-lg border border-border bg-card p-6 shadow-xl">
            <h2 className="mb-4 text-base font-semibold">创建 / 更新访问配置</h2>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-sm text-muted-foreground">AccessKey *</label>
                  <input
                    type="text"
                    value={formAccessKey}
                    onChange={(e) => setFormAccessKey(e.target.value)}
                    placeholder="rocketmq_ak"
                    className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-1 focus:ring-ring"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm text-muted-foreground">SecretKey *</label>
                  <input
                    type="password"
                    value={formSecretKey}
                    onChange={(e) => setFormSecretKey(e.target.value)}
                    placeholder="rocketmq_sk"
                    className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-1 focus:ring-ring"
                  />
                </div>
              </div>

              <div>
                <label className="mb-1 block text-sm text-muted-foreground">白名单地址</label>
                <input
                  type="text"
                  value={formWhiteAddr}
                  onChange={(e) => setFormWhiteAddr(e.target.value)}
                  placeholder="192.168.1.* 或留空"
                  className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-1 focus:ring-ring"
                />
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="isAdmin"
                  checked={formIsAdmin}
                  onChange={(e) => setFormIsAdmin(e.target.checked)}
                  className="rounded"
                />
                <label htmlFor="isAdmin" className="text-sm">管理员权限</label>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-sm text-muted-foreground">默认 Topic 权限</label>
                  <select
                    value={formDefaultTopicPerm}
                    onChange={(e) => setFormDefaultTopicPerm(e.target.value)}
                    className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-1 focus:ring-ring"
                  >
                    {PERM_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-sm text-muted-foreground">默认 Group 权限</label>
                  <select
                    value={formDefaultGroupPerm}
                    onChange={(e) => setFormDefaultGroupPerm(e.target.value)}
                    className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-1 focus:ring-ring"
                  >
                    {PERM_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="mb-1 block text-sm text-muted-foreground">
                  Topic 权限（每行一条，格式：topicName=PUB|SUB）
                </label>
                <textarea
                  value={formTopicPerms}
                  onChange={(e) => setFormTopicPerms(e.target.value)}
                  placeholder={'topicA=PUB\ntopicB=SUB\ntopicC=PUB|SUB'}
                  rows={3}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-xs outline-none focus:ring-1 focus:ring-ring"
                />
              </div>

              <div>
                <label className="mb-1 block text-sm text-muted-foreground">
                  Group 权限（每行一条，格式：groupName=SUB）
                </label>
                <textarea
                  value={formGroupPerms}
                  onChange={(e) => setFormGroupPerms(e.target.value)}
                  placeholder={'groupA=SUB\ngroupB=DENY'}
                  rows={3}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-xs outline-none focus:ring-1 focus:ring-ring"
                />
              </div>
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => { setShowForm(false); resetForm() }}
                className="h-9 rounded-md border border-input px-4 text-sm hover:bg-accent"
              >
                取消
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={saving || !formAccessKey.trim() || !formSecretKey.trim()}
                className="flex h-9 items-center gap-1.5 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                保存
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Dialog */}
      {showDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-[400px] rounded-lg border border-border bg-card p-6 shadow-xl">
            <h2 className="mb-4 text-base font-semibold">删除访问配置</h2>
            <div>
              <label className="mb-1 block text-sm text-muted-foreground">AccessKey</label>
              <input
                type="text"
                value={deleteAccessKey}
                onChange={(e) => setDeleteAccessKey(e.target.value)}
                placeholder="要删除的 AccessKey"
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => { setShowDelete(false); setDeleteAccessKey('') }}
                className="h-9 rounded-md border border-input px-4 text-sm hover:bg-accent"
              >
                取消
              </button>
              <button
                type="button"
                onClick={handleDelete}
                disabled={deleting || !deleteAccessKey.trim()}
                className="flex h-9 items-center gap-1.5 rounded-md bg-destructive px-4 text-sm font-medium text-destructive-foreground hover:bg-destructive/90 disabled:opacity-50"
              >
                {deleting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                删除
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
