import { useCallback, useEffect, useState } from 'react'
import { Key, Plus, X, Check, Trash2, AlertCircle, ShieldCheck, ShieldOff } from 'lucide-react'
import { Spinner } from '@/components/Spinner'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { PageHeader } from '@/components/PageHeader'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { useConnections } from '@/hooks/useConnections'
import * as aclApi from '@/api/acl'
import type { AclVersionInfo } from '@/api/acl'
import { formatErrorMessage } from '@/lib/utils'
import { RefreshButton, usePageRefresh } from '@/components/RefreshButton'
import { OfflineEmpty } from '@/components/OfflineEmpty'
import type { NavId } from '@/layout/Sidebar'

const PERMS = ['DENY', 'PUB', 'SUB', 'PUB|SUB'] as const

function parsePermLines(text: string): string[] {
  return text
    .split(/[\n,;]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
}

export function AclPage({ onNavigate }: { onNavigate?: (id: NavId) => void }) {
  const { t } = useTranslation()
  const { list: connections } = useConnections()
  const activeConn = connections.find((c) => c.status === 'online') ?? null
  const hasOnline = activeConn != null
  // When the active cluster changes, status must be reloaded even if still "online"
  const activeKey = activeConn ? `${activeConn.id}:${activeConn.nameServer}` : ''

  // Status
  const [enabled, setEnabled] = useState<boolean | null>(null)
  const [version, setVersion] = useState<AclVersionInfo | null>(null)
  const [statusLoading, setStatusLoading] = useState(true)
  const [statusError, setStatusError] = useState<string | null>(null)

  // Access config form
  const [ak, setAk] = useState('')
  const [sk, setSk] = useState('')
  const [whiteIp, setWhiteIp] = useState('*')
  const [admin, setAdmin] = useState(false)
  const [defaultTopicPerm, setDefaultTopicPerm] = useState<(typeof PERMS)[number]>('DENY')
  const [defaultGroupPerm, setDefaultGroupPerm] = useState<(typeof PERMS)[number]>('SUB')
  const [topicPerms, setTopicPerms] = useState('')
  const [groupPerms, setGroupPerms] = useState('')
  const [saving, setSaving] = useState(false)

  // Delete by AK
  const [deleteAk, setDeleteAk] = useState('')
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)

  // Global white list. NOTE: RocketMQ's admin protocol exposes only an
  // overwriting `UpdateGlobalWhiteAddrsConfig` RPC — there is no way to
  // read the current list, so this state cannot be initialized from the
  // broker. Saving therefore *replaces* the broker's list with whatever
  // the user typed here. The save flow is gated behind a confirmation
  // dialog and a destructive-warning banner to make this explicit.
  const [whiteList, setWhiteList] = useState<string[]>([])
  const [whiteInput, setWhiteInput] = useState('')
  const [whiteSaving, setWhiteSaving] = useState(false)
  const [confirmReplaceWhite, setConfirmReplaceWhite] = useState(false)

  const refreshStatus = useCallback(async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) setStatusLoading(true)
    setStatusError(null)
    try {
      const [en, ver] = await Promise.all([
        aclApi.getAclEnabled(),
        aclApi.getAclVersion().catch(() => null),
      ])
      setEnabled(en)
      setVersion(ver)
    } catch (e) {
      setStatusError(formatErrorMessage(e))
    } finally {
      if (!opts?.silent) setStatusLoading(false)
    }
  }, [])

  const doRefresh = useCallback(() => refreshStatus({ silent: true }), [refreshStatus])
  const { spinning: isRefreshing, refresh: handleRefresh } = usePageRefresh(doRefresh)

  useEffect(() => {
    if (!hasOnline) {
      setEnabled(null)
      setVersion(null)
      setStatusError(null)
      setStatusLoading(false)
      return
    }
    void refreshStatus()
  }, [hasOnline, activeKey, refreshStatus])

  const handleSave = async () => {
    if (!ak.trim()) {
      toast.error(t('acl.form.validateAk'))
      return
    }
    if (!sk.trim()) {
      toast.error(t('acl.form.validateSk'))
      return
    }
    setSaving(true)
    try {
      await aclApi.createOrUpdateAccessConfig(
        ak.trim(),
        sk,
        whiteIp.trim(),
        admin,
        defaultTopicPerm,
        defaultGroupPerm,
        parsePermLines(topicPerms),
        parsePermLines(groupPerms),
      )
      toast.success(t('acl.form.saveSuccess'))
      void refreshStatus()
    } catch (e) {
      toast.error(formatErrorMessage(e))
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!confirmDelete) return
    setDeleting(true)
    try {
      await aclApi.deleteAccessConfig(confirmDelete)
      toast.success(t('acl.delete.success'))
      setConfirmDelete(null)
      setDeleteAk('')
      void refreshStatus()
    } catch (e) {
      toast.error(formatErrorMessage(e))
    } finally {
      setDeleting(false)
    }
  }

  const handleAddWhite = () => {
    const v = whiteInput.trim()
    if (!v || whiteList.includes(v)) {
      setWhiteInput('')
      return
    }
    setWhiteList([...whiteList, v])
    setWhiteInput('')
  }

  const handleRemoveWhite = (ip: string) => {
    setWhiteList(whiteList.filter((x) => x !== ip))
  }

  // The save button only opens the confirmation. The actual destructive
  // RPC is in performReplaceWhite, gated behind explicit user confirm.
  const handleSaveWhite = () => {
    setConfirmReplaceWhite(true)
  }

  const performReplaceWhite = async () => {
    setConfirmReplaceWhite(false)
    setWhiteSaving(true)
    try {
      await aclApi.updateGlobalWhiteAddrs(whiteList)
      toast.success(t('acl.globalWhite.saveSuccess'))
    } catch (e) {
      toast.error(formatErrorMessage(e))
    } finally {
      setWhiteSaving(false)
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        title={t('acl.title')}
        subtitle={!hasOnline ? t('acl.subtitleNoConn') : t('acl.subtitle')}
      >
        <RefreshButton
          spinning={isRefreshing}
          disabled={!hasOnline || statusLoading}
          onClick={handleRefresh}
        />
      </PageHeader>

      <div className="scroll-thin min-h-0 flex-1 overflow-auto p-5">
        {!hasOnline ? (
          <OfflineEmpty
            message={t('acl.subtitleNoConn')}
            onAction={() => onNavigate?.('connections')}
          />
        ) : (
          <div style={{ maxWidth: 1280 }}>
            <div
              className="rl-card mb-4 text-[12px]"
              style={{
                padding: '10px 14px',
                lineHeight: 1.55,
                background: 'hsl(var(--muted) / 0.45)',
              }}
            >
              <span className="font-medium">{t('acl.limitationsTitle')}</span>
              <span className="rl-muted"> {t('acl.limitationsDesc')}</span>
            </div>
            {/* Status */}
            <div className="rl-card mb-5 flex items-center gap-3" style={{ padding: 16 }}>
              {statusLoading ? (
                <Spinner size={18} className="rl-muted shrink-0" />
              ) : enabled ? (
                <ShieldCheck size={20} style={{ color: 'hsl(var(--success))', flexShrink: 0 }} />
              ) : (
                <ShieldOff size={20} className="rl-muted shrink-0" />
              )}
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-medium">
                  {statusLoading
                    ? t('acl.status.loading')
                    : enabled
                      ? t('acl.status.enabled')
                      : t('acl.status.disabled')}
                </div>
                {version && (
                  <div className="rl-muted mt-1 flex flex-wrap gap-3 text-[12px]">
                    <span className="font-mono-design">
                      {t('acl.status.broker', { addr: version.brokerAddr || '—' })}
                    </span>
                    {version.version && (
                      <span className="font-mono-design">
                        {t('acl.status.version', { ver: version.version })}
                      </span>
                    )}
                  </div>
                )}
                {statusError && (
                  <div
                    className="mt-1 flex items-center gap-1 text-[11px]"
                    style={{ color: 'hsl(var(--destructive))' }}
                  >
                    <AlertCircle size={11} />
                    <span>{statusError}</span>
                  </div>
                )}
              </div>
            </div>

            {/* 双栏布局：账号配置主表单留在左侧主区，
                删除/全局白名单这类辅助操作折到右边窄列。
                lg 以下退回单栏，避免窄窗口下表单被挤压。 */}
            <div className="grid grid-cols-1 gap-5 lg:grid-cols-[3fr_2fr]">
              <div>
                {/* Access config form */}
                <div className="rl-section-label">{t('acl.form.title')}</div>
                <div className="rl-card" style={{ padding: 20 }}>
                  <div className="rl-muted mb-4 text-[12px]">{t('acl.form.subtitle')}</div>
                  <div className="grid gap-3.5" style={{ gridTemplateColumns: '1fr 1fr' }}>
                    <div>
                      <div className="rl-muted mb-2 text-[12px]">
                        {t('acl.form.ak')}{' '}
                        <span style={{ color: 'hsl(var(--destructive))' }}>*</span>
                      </div>
                      <input
                        className="rl-input font-mono-design"
                        placeholder={t('acl.form.akPlaceholder')}
                        value={ak}
                        onChange={(e) => setAk(e.target.value)}
                      />
                    </div>
                    <div>
                      <div className="rl-muted mb-2 text-[12px]">
                        {t('acl.form.sk')}{' '}
                        <span style={{ color: 'hsl(var(--destructive))' }}>*</span>
                      </div>
                      <input
                        className="rl-input font-mono-design"
                        type="password"
                        placeholder={t('acl.form.skPlaceholder')}
                        value={sk}
                        onChange={(e) => setSk(e.target.value)}
                      />
                    </div>
                    <div style={{ gridColumn: '1 / -1' }}>
                      <div className="rl-muted mb-2 text-[12px]">{t('acl.form.whiteIp')}</div>
                      <input
                        className="rl-input font-mono-design"
                        placeholder={t('acl.form.whiteIpPlaceholder')}
                        value={whiteIp}
                        onChange={(e) => setWhiteIp(e.target.value)}
                      />
                    </div>
                    <div>
                      <div className="rl-muted mb-2 text-[12px]">
                        {t('acl.form.defaultTopicPerm')}
                      </div>
                      <select
                        className="rl-select"
                        value={defaultTopicPerm}
                        onChange={(e) =>
                          setDefaultTopicPerm(e.target.value as (typeof PERMS)[number])
                        }
                      >
                        {PERMS.map((p) => (
                          <option key={p} value={p}>
                            {p}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <div className="rl-muted mb-2 text-[12px]">
                        {t('acl.form.defaultGroupPerm')}
                      </div>
                      <select
                        className="rl-select"
                        value={defaultGroupPerm}
                        onChange={(e) =>
                          setDefaultGroupPerm(e.target.value as (typeof PERMS)[number])
                        }
                      >
                        {PERMS.map((p) => (
                          <option key={p} value={p}>
                            {p}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div style={{ gridColumn: '1 / -1' }}>
                      <label
                        className="flex items-center gap-2 text-[13px]"
                        style={{ cursor: 'pointer' }}
                      >
                        <input
                          type="checkbox"
                          checked={admin}
                          onChange={(e) => setAdmin(e.target.checked)}
                        />
                        <span>{t('acl.form.admin')}</span>
                        <span className="rl-muted text-[12px]">· {t('acl.form.adminHint')}</span>
                      </label>
                    </div>
                    <div style={{ gridColumn: '1 / -1' }}>
                      <div className="rl-muted mb-2 text-[12px]">{t('acl.form.topicPerms')}</div>
                      <textarea
                        className="rl-input font-mono-design"
                        style={{
                          width: '100%',
                          minHeight: 80,
                          padding: 10,
                          fontSize: 12,
                          resize: 'vertical',
                        }}
                        placeholder="ORDER_TOPIC=PUB|SUB&#10;AUDIT_LOG=PUB"
                        value={topicPerms}
                        onChange={(e) => setTopicPerms(e.target.value)}
                      />
                      <div className="rl-muted mt-1 text-[11px]">
                        {t('acl.form.topicPermsHint')}
                      </div>
                    </div>
                    <div style={{ gridColumn: '1 / -1' }}>
                      <div className="rl-muted mb-2 text-[12px]">{t('acl.form.groupPerms')}</div>
                      <textarea
                        className="rl-input font-mono-design"
                        style={{
                          width: '100%',
                          minHeight: 60,
                          padding: 10,
                          fontSize: 12,
                          resize: 'vertical',
                        }}
                        placeholder="GID_ADMIN=SUB"
                        value={groupPerms}
                        onChange={(e) => setGroupPerms(e.target.value)}
                      />
                      <div className="rl-muted mt-1 text-[11px]">
                        {t('acl.form.groupPermsHint')}
                      </div>
                    </div>
                  </div>
                  <div
                    className="mt-5 flex justify-end"
                    style={{ paddingTop: 16, borderTop: '1px solid hsl(var(--border))' }}
                  >
                    <button
                      className="rl-btn rl-btn-primary rl-btn-sm"
                      onClick={handleSave}
                      disabled={saving}
                    >
                      {saving ? <Spinner size={13} /> : <Check size={13} />}
                      {saving ? t('acl.form.saving') : t('acl.form.submit')}
                    </button>
                  </div>
                </div>
              </div>
              <div className="flex flex-col gap-5">
                <div>
                  {/* Delete by AK */}
                  <div className="rl-section-label">{t('acl.delete.title')}</div>
                  <div className="rl-card" style={{ padding: 20 }}>
                    <div className="rl-muted mb-3 text-[12px]">{t('acl.delete.subtitle')}</div>
                    <div className="flex gap-2">
                      <input
                        className="rl-input font-mono-design"
                        placeholder={t('acl.form.akPlaceholder')}
                        value={deleteAk}
                        onChange={(e) => setDeleteAk(e.target.value)}
                        style={{ flex: 1 }}
                      />
                      <button
                        className="rl-btn rl-btn-outline rl-btn-sm"
                        style={{ color: 'hsl(var(--destructive))' }}
                        onClick={() => deleteAk.trim() && setConfirmDelete(deleteAk.trim())}
                        disabled={!deleteAk.trim()}
                      >
                        <Trash2 size={13} />
                        {t('acl.delete.submit')}
                      </button>
                    </div>
                  </div>
                </div>
                <div>
                  {/* Global white list */}
                  <div className="rl-section-label">{t('acl.globalWhite.title')}</div>
                  <div className="rl-card" style={{ padding: 20 }}>
                    <div className="rl-muted mb-3 text-[12px]">{t('acl.globalWhite.subtitle')}</div>
                    <div className="flex flex-col gap-2">
                      {whiteList.length === 0 ? (
                        <div className="rl-muted text-[12px]" style={{ padding: '8px 0' }}>
                          {t('acl.globalWhite.empty')}
                        </div>
                      ) : (
                        whiteList.map((ip) => (
                          <div
                            key={ip}
                            className="flex items-center justify-between"
                            style={{
                              padding: '6px 10px',
                              border: '1px solid hsl(var(--border))',
                              borderRadius: 6,
                              background: 'hsl(var(--background))',
                            }}
                          >
                            <span className="font-mono-design text-[12px]">
                              <Key size={11} className="rl-muted mr-2 inline" />
                              {ip}
                            </span>
                            <button
                              className="rl-btn rl-btn-ghost rl-btn-icon rl-btn-sm"
                              onClick={() => handleRemoveWhite(ip)}
                            >
                              <X size={12} />
                            </button>
                          </div>
                        ))
                      )}
                    </div>
                    <div className="mt-3 flex gap-2">
                      <input
                        className="rl-input font-mono-design"
                        placeholder={t('acl.globalWhite.addPlaceholder')}
                        value={whiteInput}
                        onChange={(e) => setWhiteInput(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleAddWhite()}
                        style={{ flex: 1 }}
                      />
                      <button
                        className="rl-btn rl-btn-outline rl-btn-sm"
                        onClick={handleAddWhite}
                        disabled={!whiteInput.trim()}
                      >
                        <Plus size={13} />
                        {t('acl.globalWhite.add')}
                      </button>
                    </div>
                    <div
                      className="mt-4"
                      style={{ paddingTop: 12, borderTop: '1px solid hsl(var(--border))' }}
                    >
                      <div
                        className="mb-3 flex items-start gap-2 text-[12px]"
                        style={{
                          padding: '8px 10px',
                          borderRadius: 6,
                          background: 'hsl(var(--destructive) / 0.08)',
                          color: 'hsl(var(--destructive))',
                        }}
                      >
                        <AlertCircle size={14} className="mt-0.5 shrink-0" />
                        <span>{t('acl.globalWhite.warning')}</span>
                      </div>
                      <div className="flex justify-end">
                        <button
                          className="rl-btn rl-btn-destructive rl-btn-sm"
                          onClick={handleSaveWhite}
                          disabled={whiteSaving}
                        >
                          {whiteSaving ? <Spinner size={13} /> : <Check size={13} />}
                          {whiteSaving ? t('acl.globalWhite.saving') : t('acl.globalWhite.save')}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      <ConfirmDialog
        open={confirmDelete != null}
        title={t('acl.delete.confirmTitle')}
        description={t('acl.delete.confirmDesc', { ak: confirmDelete ?? '' })}
        confirmText={deleting ? t('common.loading') : t('common.delete')}
        cancelText={t('common.cancel')}
        variant="destructive"
        onConfirm={handleDelete}
        onCancel={() => !deleting && setConfirmDelete(null)}
      />

      <ConfirmDialog
        open={confirmReplaceWhite}
        title={t('acl.globalWhite.confirmTitle')}
        description={
          whiteList.length === 0
            ? t('acl.globalWhite.confirmEmptyBody')
            : t('acl.globalWhite.confirmBody', { count: whiteList.length })
        }
        confirmText={t('acl.globalWhite.confirmAction')}
        cancelText={t('common.cancel')}
        variant="destructive"
        onConfirm={performReplaceWhite}
        onCancel={() => setConfirmReplaceWhite(false)}
      />
    </div>
  )
}
