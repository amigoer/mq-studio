import { useCallback, useEffect, useState } from 'react'
import { Key, Plus, X, Check, Trash2, AlertCircle, ShieldCheck, ShieldOff, ChevronRight } from 'lucide-react'
import { Spinner } from '@/components/Spinner'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { PageHeader } from '@/components/PageHeader'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { useConnections } from '@/hooks/useConnections'
import * as aclApi from '@/api/acl'
import type { AclVersionInfo } from '@/api/acl'
import { cn, formatErrorMessage } from '@/lib/utils'
import { RefreshButton, usePageRefresh } from '@/components/RefreshButton'
import { OfflineEmpty } from '@/components/OfflineEmpty'
import type { NavId } from '@/layout/Sidebar'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Card } from '@/components/ui/card'

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
  const [showAdvanced, setShowAdvanced] = useState(false)
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

  // Number of per-resource overrides currently entered — shown as a badge on
  // the collapsed "advanced" toggle so hidden entries are never a surprise.
  const overrideCount = parsePermLines(topicPerms).length + parsePermLines(groupPerms).length

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
            {/* Status banner */}
            <div
              className="mb-4 flex items-center gap-3 rounded-xl border px-3.5 py-3"
              style={
                enabled
                  ? {
                      borderColor: 'hsl(var(--success) / 0.28)',
                      background: 'hsl(var(--success) / 0.06)',
                    }
                  : { borderColor: 'hsl(var(--border))', background: 'hsl(var(--card))' }
              }
            >
              {statusLoading ? (
                <Spinner size={18} className="text-muted-foreground shrink-0" />
              ) : enabled ? (
                <ShieldCheck size={20} style={{ color: 'hsl(var(--success))', flexShrink: 0 }} />
              ) : (
                <ShieldOff size={20} className="text-muted-foreground shrink-0" />
              )}
              <div className="min-w-0 flex-1">
                <div
                  className="text-[12.5px] font-semibold"
                  style={enabled ? { color: 'hsl(var(--success))' } : undefined}
                >
                  {statusLoading
                    ? t('acl.status.loading')
                    : enabled
                      ? t('acl.status.enabled')
                      : t('acl.status.disabled')}
                </div>
                {version && (
                  <div className="text-muted-foreground mt-1 flex flex-wrap gap-3 text-[11px]">
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
              {enabled && !statusLoading && (
                <span
                  className="h-[7px] w-[7px] shrink-0 rounded-full"
                  style={{
                    background: 'hsl(var(--success))',
                    animation: 'rl-conn-pulse 2.2s ease-in-out infinite',
                  }}
                />
              )}
            </div>

            {/* Limitations note */}
            <Card
              className="mb-5 text-[12px]"
              style={{
                padding: '10px 14px',
                lineHeight: 1.55,
                background: 'hsl(var(--muted) / 0.45)',
              }}
            >
              <span className="font-medium">{t('acl.limitationsTitle')}</span>
              <span className="text-muted-foreground"> {t('acl.limitationsDesc')}</span>
            </Card>

            {/* Two-column layout fills the width: the account create/update
                form on the left, the two secondary actions (delete by AK and
                the destructive global allow-list replace) stacked on the right.
                Collapses to one column below lg. */}
            <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
              <div className="flex flex-col gap-5">
                {/* Access config form */}
                <Card style={{ padding: 20 }}>
                  <div className="mb-4">
                    <div className="text-[13px] font-semibold">{t('acl.form.title')}</div>
                    <div className="text-muted-foreground mt-0.5 text-[12px]">{t('acl.form.subtitle')}</div>
                  </div>
                  <div className="grid gap-3.5" style={{ gridTemplateColumns: '1fr 1fr' }}>
                    <div>
                      <div className="text-muted-foreground mb-2 text-[12px]">
                        {t('acl.form.ak')}{' '}
                        <span style={{ color: 'hsl(var(--destructive))' }}>*</span>
                      </div>
                      <Input
                        className="font-mono-design"
                        placeholder={t('acl.form.akPlaceholder')}
                        value={ak}
                        onChange={(e) => setAk(e.target.value)}
                      />
                    </div>
                    <div>
                      <div className="text-muted-foreground mb-2 text-[12px]">
                        {t('acl.form.sk')}{' '}
                        <span style={{ color: 'hsl(var(--destructive))' }}>*</span>
                      </div>
                      <Input
                        className="font-mono-design"
                        type="password"
                        placeholder={t('acl.form.skPlaceholder')}
                        value={sk}
                        onChange={(e) => setSk(e.target.value)}
                      />
                    </div>
                    <div style={{ gridColumn: '1 / -1' }}>
                      <div className="text-muted-foreground mb-2 text-[12px]">{t('acl.form.whiteIp')}</div>
                      <Input
                        className="font-mono-design"
                        placeholder={t('acl.form.whiteIpPlaceholder')}
                        value={whiteIp}
                        onChange={(e) => setWhiteIp(e.target.value)}
                      />
                    </div>

                    {/* Admin toggle. When on, this account has all permissions,
                        so the per-resource permission controls below are hidden. */}
                    <div
                      style={{ gridColumn: '1 / -1' }}
                      className="flex items-start gap-2.5 rounded-lg border border-border/70 px-3 py-2.5"
                    >
                      <Switch checked={admin} onCheckedChange={setAdmin} className="mt-0.5 shrink-0" />
                      <div>
                        <div className="text-[12.5px] font-medium">{t('acl.form.admin')}</div>
                        <div className="text-muted-foreground mt-0.5 text-[11px]">
                          {t('acl.form.adminHint')}
                        </div>
                      </div>
                    </div>

                    {admin ? (
                      <div
                        style={{ gridColumn: '1 / -1' }}
                        className="text-muted-foreground flex items-center gap-2 text-[11.5px]"
                      >
                        <ShieldCheck size={13} style={{ color: 'hsl(var(--success))' }} className="shrink-0" />
                        <span>{t('acl.form.adminActive')}</span>
                      </div>
                    ) : (
                      <>
                        <div>
                          <div className="text-muted-foreground mb-2 text-[12px]">
                            {t('acl.form.defaultTopicPerm')}
                          </div>
                          <Select
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
                          </Select>
                        </div>
                        <div>
                          <div className="text-muted-foreground mb-2 text-[12px]">
                            {t('acl.form.defaultGroupPerm')}
                          </div>
                          <Select
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
                          </Select>
                        </div>

                        {/* Advanced: per-resource overrides, collapsed by default
                            since most accounts only need the defaults above. */}
                        <div style={{ gridColumn: '1 / -1' }}>
                          <button
                            type="button"
                            onClick={() => setShowAdvanced((v) => !v)}
                            className="text-muted-foreground hover:text-foreground -mx-1 flex w-full items-center gap-1.5 rounded-md px-1 py-1 text-left text-[12px] transition-colors"
                          >
                            <ChevronRight
                              size={14}
                              className={cn('shrink-0 transition-transform', showAdvanced && 'rotate-90')}
                            />
                            <span className="font-medium">{t('acl.form.advanced')}</span>
                            {overrideCount > 0 && (
                              <span
                                className="ml-1 rounded-full px-1.5 text-[10px] font-semibold tabular-nums"
                                style={{
                                  background: 'hsl(var(--primary) / 0.12)',
                                  color: 'hsl(var(--primary))',
                                }}
                              >
                                {overrideCount}
                              </span>
                            )}
                            <span className="text-muted-foreground/70 ml-auto text-[11px]">
                              {t('acl.form.advancedHint')}
                            </span>
                          </button>
                          {showAdvanced && (
                            <div className="mt-3 grid gap-3.5">
                              <div>
                                <div className="text-muted-foreground mb-2 text-[12px]">{t('acl.form.topicPerms')}</div>
                                <Textarea
                                  className="min-h-[76px] font-mono-design text-[12px]"
                                  placeholder="ORDER_TOPIC=PUB|SUB&#10;AUDIT_LOG=PUB"
                                  value={topicPerms}
                                  onChange={(e) => setTopicPerms(e.target.value)}
                                />
                                <div className="text-muted-foreground mt-1 text-[11px]">
                                  {t('acl.form.topicPermsHint')}
                                </div>
                              </div>
                              <div>
                                <div className="text-muted-foreground mb-2 text-[12px]">{t('acl.form.groupPerms')}</div>
                                <Textarea
                                  className="min-h-[56px] font-mono-design text-[12px]"
                                  placeholder="GID_ADMIN=SUB"
                                  value={groupPerms}
                                  onChange={(e) => setGroupPerms(e.target.value)}
                                />
                                <div className="text-muted-foreground mt-1 text-[11px]">
                                  {t('acl.form.groupPermsHint')}
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                  <div
                    className="mt-5 flex justify-end"
                    style={{ paddingTop: 16, borderTop: '1px solid hsl(var(--border))' }}
                  >
                    <Button variant="default" size="sm"
                      onClick={handleSave}
                      disabled={saving}
                    >
                      {saving ? <Spinner size={13} /> : <Check size={13} />}
                      {saving ? t('acl.form.saving') : t('acl.form.submit')}
                    </Button>
                  </div>
                </Card>
              </div>

              {/* Right column: secondary write actions */}
              <div className="flex flex-col gap-5">
                {/* Delete by AK — de-emphasized danger action. */}
                <Card
                  style={{ padding: 20, borderColor: 'hsl(var(--destructive) / 0.28)' }}
                >
                  <div className="mb-3">
                    <div className="text-[13px] font-semibold">{t('acl.delete.title')}</div>
                    <div className="text-muted-foreground mt-0.5 text-[12px]">{t('acl.delete.subtitle')}</div>
                  </div>
                  <div className="flex gap-2">
                    <Input
                      className="font-mono-design"
                      placeholder={t('acl.form.akPlaceholder')}
                      value={deleteAk}
                      onChange={(e) => setDeleteAk(e.target.value)}
                      style={{ flex: 1 }}
                    />
                    <Button variant="outline" size="sm"
                      style={{ color: 'hsl(var(--destructive))' }}
                      onClick={() => deleteAk.trim() && setConfirmDelete(deleteAk.trim())}
                      disabled={!deleteAk.trim()}
                    >
                      <Trash2 size={13} />
                      {t('acl.delete.submit')}
                    </Button>
                  </div>
                </Card>

                {/* Global white list */}
                <Card style={{ padding: 20 }}>
                  <div className="mb-3">
                    <div className="text-[13px] font-semibold">{t('acl.globalWhite.title')}</div>
                    <div className="text-muted-foreground mt-0.5 text-[12px]">{t('acl.globalWhite.subtitle')}</div>
                  </div>
                  <div className="flex flex-col gap-2">
                    {whiteList.length === 0 ? (
                      <div className="text-muted-foreground text-[12px]" style={{ padding: '8px 0' }}>
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
                            <Key size={11} className="text-muted-foreground mr-2 inline" />
                            {ip}
                          </span>
                          <Button variant="ghost" size="icon-sm"
                            onClick={() => handleRemoveWhite(ip)}
                          >
                            <X size={12} />
                          </Button>
                        </div>
                      ))
                    )}
                  </div>
                  <div className="mt-3 flex gap-2">
                    <Input
                      className="font-mono-design"
                      placeholder={t('acl.globalWhite.addPlaceholder')}
                      value={whiteInput}
                      onChange={(e) => setWhiteInput(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleAddWhite()}
                      style={{ flex: 1 }}
                    />
                    <Button variant="outline" size="sm"
                      onClick={handleAddWhite}
                      disabled={!whiteInput.trim()}
                    >
                      <Plus size={13} />
                      {t('acl.globalWhite.add')}
                    </Button>
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
                      <Button variant="destructive" size="sm"
                        onClick={handleSaveWhite}
                        disabled={whiteSaving}
                      >
                        {whiteSaving ? <Spinner size={13} /> : <Check size={13} />}
                        {whiteSaving ? t('acl.globalWhite.saving') : t('acl.globalWhite.save')}
                      </Button>
                    </div>
                  </div>
                </Card>
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
