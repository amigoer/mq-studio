import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Search,
  Plus,
  Check,
  Unlink,
  PlugZap,
  Trash2,
  Wifi,
  Star,
  ChevronDown,
  ChevronRight,
  X,
} from 'lucide-react'
import { Spinner } from '@/components/Spinner'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { PageHeader } from '../shell'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { useConnections } from '@/hooks/useConnections'
import * as connectionApi from '@/api/connection'
import { formatErrorMessage, cn } from '@/lib/utils'
import { ConnectionEnv, type Connection } from '@generated/models'
import {
  hasConnectionPrefill,
  takeConnectionPrefill,
  type ConnectionPrefill,
} from '@/lib/connectionPrefill'

const NEW_FORM_ID = -1
const DEFAULT_NS_PORT = '9876'

interface NsEntry {
  host: string
  port: string
}

interface FormState {
  id: number
  name: string
  env: ConnectionEnv
  nsEntries: NsEntry[]
  timeoutSec: number
  enableACL: boolean
  accessKey: string
  secretKey: string
  remark: string
}

function parseNameServers(raw: string): NsEntry[] {
  const parts = String(raw || '')
    .split(/[;\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean)
  if (parts.length === 0) return [{ host: '', port: DEFAULT_NS_PORT }]
  return parts.map((p) => {
    // [ipv6]:port
    if (p.startsWith('[')) {
      const m = p.match(/^\[([^\]]+)\](?::(\d+))?$/)
      if (m) return { host: m[1] ?? '', port: m[2] || DEFAULT_NS_PORT }
    }
    const lastColon = p.lastIndexOf(':')
    if (lastColon > 0 && /^\d+$/.test(p.slice(lastColon + 1))) {
      return { host: p.slice(0, lastColon), port: p.slice(lastColon + 1) }
    }
    return { host: p, port: DEFAULT_NS_PORT }
  })
}

function joinNameServers(entries: NsEntry[]): string {
  return entries
    .map((e) => {
      const host = e.host.trim()
      if (!host) return ''
      const port = (e.port.trim() || DEFAULT_NS_PORT).replace(/\D/g, '') || DEFAULT_NS_PORT
      if (host.includes(':') && !host.startsWith('[')) {
        return `[${host}]:${port}`
      }
      return `${host}:${port}`
    })
    .filter(Boolean)
    .join(';')
}

const EMPTY_FORM: FormState = {
  id: NEW_FORM_ID,
  name: '',
  env: ConnectionEnv.EnvTest,
  nsEntries: [{ host: '', port: DEFAULT_NS_PORT }],
  timeoutSec: 5,
  enableACL: false,
  accessKey: '',
  secretKey: '',
  remark: '',
}

function fromConnection(c: Connection): FormState {
  return {
    id: c.id,
    name: c.name,
    env: c.env,
    nsEntries: parseNameServers(c.nameServer),
    timeoutSec: c.timeoutSec || 5,
    enableACL: c.enableACL,
    accessKey: c.accessKey,
    secretKey: c.secretKey,
    remark: c.remark,
  }
}

function formFromPrefill(prefill: ConnectionPrefill): FormState {
  let nsEntries: NsEntry[] = [{ host: '', port: DEFAULT_NS_PORT }]
  if (prefill.nameServer?.trim()) {
    nsEntries = parseNameServers(prefill.nameServer)
  } else if (prefill.host?.trim()) {
    nsEntries = [{ host: prefill.host.trim(), port: prefill.port?.trim() || DEFAULT_NS_PORT }]
  }
  return {
    ...EMPTY_FORM,
    name: prefill.name?.trim() || '',
    nsEntries,
  }
}

function updateNsEntry(entries: NsEntry[], index: number, patch: Partial<NsEntry>): NsEntry[] {
  return entries.map((e, i) => (i === index ? { ...e, ...patch } : e))
}

export function ConnectionsScreen() {
  const { t } = useTranslation()
  const { list, loading, refresh } = useConnections()

  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [search, setSearch] = useState('')
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [originalForm, setOriginalForm] = useState<FormState>(EMPTY_FORM)
  const [busy, setBusy] = useState<
    'test' | 'connect' | 'disconnect' | 'save' | 'delete' | 'row-connect' | 'row-disconnect' | null
  >(null)
  const [busyId, setBusyId] = useState<number | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<Connection | null>(null)
  const [advancedOpen, setAdvancedOpen] = useState(false)
  // Guards against React Strict Mode double-effect wiping a just-applied prefill
  const newFormCycle = useRef(0)
  const appliedNewCycle = useRef(-1)

  const openNewForm = () => {
    newFormCycle.current += 1
    setSelectedId(NEW_FORM_ID)
  }

  // Prefill from EmptyState quick-start samples (sessionStorage)
  useEffect(() => {
    if (hasConnectionPrefill()) {
      openNewForm()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only handoff
  }, [])

  useEffect(() => {
    if (selectedId == null && list.length > 0 && !hasConnectionPrefill()) {
      setSelectedId(list[0]!.id)
    }
  }, [list, selectedId])

  const selected = useMemo<Connection | null>(
    () => (selectedId == null ? null : (list.find((c) => c.id === selectedId) ?? null)),
    [list, selectedId],
  )

  useEffect(() => {
    if (selectedId === NEW_FORM_ID) {
      if (appliedNewCycle.current === newFormCycle.current) return
      appliedNewCycle.current = newFormCycle.current
      const prefill = takeConnectionPrefill()
      if (prefill) {
        setForm(formFromPrefill(prefill))
        // Mark dirty relative to empty so Save is enabled when prefilled
        setOriginalForm(EMPTY_FORM)
      } else {
        setForm(EMPTY_FORM)
        setOriginalForm(EMPTY_FORM)
      }
      setAdvancedOpen(false)
      return
    }
    if (selected) {
      const next = fromConnection(selected)
      setForm(next)
      setOriginalForm(next)
      setAdvancedOpen(selected.enableACL || selected.timeoutSec !== 5 || !!selected.remark)
    }
  }, [selected, selectedId])

  const isNew = selectedId === NEW_FORM_ID
  const dirty = useMemo(
    () => JSON.stringify(form) !== JSON.stringify(originalForm),
    [form, originalForm],
  )

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return list
    return list.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.nameServer.toLowerCase().includes(q) ||
        (c.remark || '').toLowerCase().includes(q),
    )
  }, [list, search])

  const showSearch = list.length >= 5

  const validate = (f: FormState = form): string | null => {
    if (!f.name.trim()) return t('connections.validateName')
    const joined = joinNameServers(f.nsEntries)
    if (!joined) return t('connections.validateNameServer')
    for (const e of f.nsEntries) {
      if (!e.host.trim()) continue
      const port = Number(e.port.trim() || DEFAULT_NS_PORT)
      if (!Number.isFinite(port) || port < 1 || port > 65535) {
        return t('connections.validatePort')
      }
    }
    if (f.enableACL && (!f.accessKey.trim() || !f.secretKey.trim())) {
      return t('connections.validateAcl')
    }
    return null
  }

  const handleNew = () => openNewForm()
  const handleSelect = (c: Connection) => setSelectedId(c.id)

  /** Persist form; returns connection id or null on failure */
  const persistForm = async (opts?: { quiet?: boolean }): Promise<number | null> => {
    const err = validate()
    if (err) {
      toast.error(err)
      return null
    }
    const nameServer = joinNameServers(form.nsEntries)
    if (isNew) {
      const created = await connectionApi.addConnection(
        form.name.trim(),
        form.env,
        nameServer,
        form.timeoutSec,
        form.enableACL,
        form.accessKey.trim(),
        form.secretKey,
        form.remark.trim(),
      )
      if (!created) return null
      if (!opts?.quiet) {
        toast.success(t('connections.createSuccess', { name: form.name.trim() }))
      }
      await refresh()
      setSelectedId(created.id)
      return created.id
    }
    if (dirty) {
      await connectionApi.updateConnection(
        form.id,
        form.name.trim(),
        form.env,
        nameServer,
        form.timeoutSec,
        form.enableACL,
        form.accessKey.trim(),
        form.secretKey,
        form.remark.trim(),
      )
      if (!opts?.quiet) {
        toast.success(t('connections.saveSuccess', { name: form.name.trim() }))
      }
      await refresh()
    }
    return form.id
  }

  const handleSaveOnly = async () => {
    setBusy('save')
    try {
      await persistForm()
    } catch (e) {
      toast.error(formatErrorMessage(e))
    } finally {
      setBusy(null)
    }
  }

  /** Primary path: save if needed, then connect. Optionally promote to default. */
  const handleConnectPrimary = async () => {
    setBusy('connect')
    try {
      const id = await persistForm({ quiet: true })
      if (id == null) return

      await connectionApi.connect(id)
      const conn = (await connectionApi.getConnections()).find((c) => c && c.id === id)
      if (conn && !conn.isDefault) {
        try {
          await connectionApi.setDefaultConnection(id)
        } catch {
          // non-fatal: already connected
        }
      }
      toast.success(
        t('connections.connectSuccess', { name: form.name.trim() || conn?.name || String(id) }),
      )
      await refresh()
      setSelectedId(id)
    } catch (e) {
      toast.error(formatErrorMessage(e))
      await refresh()
    } finally {
      setBusy(null)
    }
  }

  const handleDisconnectPrimary = async () => {
    if (isNew || !selected) return
    setBusy('disconnect')
    try {
      await connectionApi.disconnect(selected.id)
      toast.success(t('connections.disconnectSuccess', { name: selected.name }))
      await refresh()
    } catch (e) {
      toast.error(formatErrorMessage(e))
    } finally {
      setBusy(null)
    }
  }

  /** List row: connect saved profile as-is (no form merge). */
  const handleRowConnect = async (c: Connection, e: React.MouseEvent) => {
    e.stopPropagation()
    setBusy('row-connect')
    setBusyId(c.id)
    try {
      await connectionApi.connect(c.id)
      if (!c.isDefault) {
        try {
          await connectionApi.setDefaultConnection(c.id)
        } catch {
          // ignore
        }
      }
      toast.success(t('connections.connectSuccess', { name: c.name }))
      setSelectedId(c.id)
      await refresh()
    } catch (err) {
      toast.error(formatErrorMessage(err))
    } finally {
      setBusy(null)
      setBusyId(null)
    }
  }

  const handleRowDisconnect = async (c: Connection, e: React.MouseEvent) => {
    e.stopPropagation()
    setBusy('row-disconnect')
    setBusyId(c.id)
    try {
      await connectionApi.disconnect(c.id)
      toast.success(t('connections.disconnectSuccess', { name: c.name }))
      await refresh()
    } catch (err) {
      toast.error(formatErrorMessage(err))
    } finally {
      setBusy(null)
      setBusyId(null)
    }
  }

  const handleTest = async () => {
    setBusy('test')
    try {
      // Need a saved id; auto-save dirty/new first
      const id = await persistForm({ quiet: true })
      if (id == null) return
      const result = await connectionApi.testConnection(id)
      toast.success(t('connections.testSuccess'), { description: result })
      await refresh()
    } catch (e) {
      toast.error(t('connections.testFail'), { description: formatErrorMessage(e) })
    } finally {
      setBusy(null)
    }
  }

  const handleSetDefault = async () => {
    if (isNew || !selected) return
    try {
      if (dirty) {
        const id = await persistForm({ quiet: true })
        if (id == null) return
      }
      await connectionApi.setDefaultConnection(selected.id)
      toast.success(t('connections.setDefaultSuccess', { name: selected.name }))
      await refresh()
    } catch (e) {
      toast.error(formatErrorMessage(e))
    }
  }

  const handleDelete = async () => {
    if (!confirmDelete) return
    setBusy('delete')
    try {
      await connectionApi.deleteConnection(confirmDelete.id)
      toast.success(t('connections.deleteSuccess'))
      setConfirmDelete(null)
      const remaining = list.filter((c) => c.id !== confirmDelete.id)
      setSelectedId(remaining[0]?.id ?? null)
      await refresh()
    } catch (e) {
      toast.error(formatErrorMessage(e))
    } finally {
      setBusy(null)
    }
  }

  const isOnline = selected?.status === 'online'
  const primaryBusy = busy === 'connect' || busy === 'disconnect' || busy === 'save'
  const anyBusy = busy != null

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        title={t('connections.title')}
        subtitle={t('connections.subtitle', { count: list.length })}
      >
        {showSearch && (
          <div className="rl-search-input" style={{ width: 180 }}>
            <span className="icon">
              <Search size={13} />
            </span>
            <input
              className="rl-input"
              placeholder={t('connections.searchPlaceholder')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        )}
        <button className="rl-btn rl-btn-primary rl-btn-sm" onClick={handleNew}>
          <Plus size={13} />
          {t('common.create')}
        </button>
      </PageHeader>

      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* List */}
        <div className="scroll-thin flex w-[280px] shrink-0 flex-col border-r border-border bg-background">
          <div className="min-h-0 flex-1 overflow-auto">
            {loading && list.length === 0 ? (
              <div className="rl-muted flex items-center justify-center gap-2 p-8">
                <Spinner size={14} />
                <span className="text-[12px]">{t('common.loading')}</span>
              </div>
            ) : filtered.length === 0 ? (
              <div className="rl-muted px-4 py-10 text-center">
                <div className="text-[12.5px]">{t('connections.empty')}</div>
                <div className="mt-1 text-[11.5px]">{t('connections.emptyHint')}</div>
              </div>
            ) : (
              filtered.map((c) => {
                const active = selectedId === c.id
                const online = c.status === 'online'
                const rowBusy =
                  busyId === c.id && (busy === 'row-connect' || busy === 'row-disconnect')
                return (
                  <div
                    key={c.id}
                    className={cn('rl-conn-row group', active && 'active')}
                    onClick={() => handleSelect(c)}
                  >
                    <span
                      className="h-1.5 w-1.5 shrink-0 rounded-full"
                      style={{
                        background: online
                          ? 'hsl(var(--success))'
                          : 'hsl(var(--muted-foreground) / 0.35)',
                      }}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="truncate text-[12.5px] font-medium">{c.name}</span>
                        {c.isDefault && (
                          <span className="rl-muted shrink-0 text-[10px]">
                            {t('connections.default')}
                          </span>
                        )}
                      </div>
                      <div className="font-mono-design rl-muted mt-0.5 truncate text-[11px]">
                        {(c.nameServer || '').split(/[;\s,]+/)[0] || '—'}
                      </div>
                    </div>
                    <button
                      type="button"
                      className={cn(
                        'rl-btn rl-btn-sm shrink-0 px-2',
                        online ? 'rl-btn-outline' : 'rl-btn-primary',
                      )}
                      disabled={anyBusy}
                      title={online ? t('connections.disconnect') : t('connections.connect')}
                      onClick={(e) => (online ? handleRowDisconnect(c, e) : handleRowConnect(c, e))}
                    >
                      {rowBusy ? (
                        <Spinner size={12} />
                      ) : online ? (
                        <Unlink size={12} />
                      ) : (
                        <PlugZap size={12} />
                      )}
                    </button>
                  </div>
                )
              })
            )}
          </div>
          <div className="border-t border-border p-2">
            <button
              className="rl-btn rl-btn-outline rl-btn-sm w-full justify-center"
              onClick={handleNew}
            >
              <Plus size={13} />
              {list.length === 0 ? t('connections.addFirst') : t('connections.newConnection')}
            </button>
          </div>
        </div>

        {/* Detail */}
        <div className="scroll-thin min-w-0 flex-1 overflow-auto p-5">
          {selectedId == null ? (
            <div className="rl-muted flex min-h-[200px] flex-col items-center justify-center text-center">
              <PlugZap size={22} className="mb-2 opacity-40" />
              <div className="text-[12.5px]">{t('connections.selectHint')}</div>
            </div>
          ) : (
            <div className="mx-auto max-w-lg">
              {/* Header + primary action */}
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="truncate text-[15px] font-semibold tracking-tight">
                      {isNew ? t('connections.newTitle') : selected?.name || form.name}
                    </h2>
                    {!isNew &&
                      selected &&
                      (isOnline ? (
                        <span className="rl-badge rl-badge-success">
                          <span className="h-1.5 w-1.5 rounded-full bg-current" />
                          {t('common.connected')}
                        </span>
                      ) : (
                        <span className="rl-badge rl-badge-outline">{t('common.offline')}</span>
                      ))}
                    {dirty && !isNew && (
                      <span className="rl-muted text-[11px]">{t('connections.unsaved')}</span>
                    )}
                  </div>
                  <div className="rl-muted mt-1 text-[11.5px]">
                    {isNew
                      ? t('connections.connectHintNew')
                      : isOnline
                        ? t('connections.connectHintOnline')
                        : t('connections.connectHint')}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  {isOnline && !isNew ? (
                    <button
                      className="rl-btn rl-btn-outline rl-btn-sm"
                      onClick={handleDisconnectPrimary}
                      disabled={primaryBusy}
                    >
                      {busy === 'disconnect' ? <Spinner size={13} /> : <Unlink size={13} />}
                      {t('connections.disconnect')}
                    </button>
                  ) : (
                    <button
                      className="rl-btn rl-btn-primary rl-btn-sm"
                      onClick={handleConnectPrimary}
                      disabled={primaryBusy}
                    >
                      {busy === 'connect' ? <Spinner size={13} /> : <PlugZap size={13} />}
                      {isNew
                        ? t('connections.saveAndConnect')
                        : dirty
                          ? t('connections.saveAndConnect')
                          : t('connections.connect')}
                    </button>
                  )}
                </div>
              </div>

              <div className="rl-card p-4">
                <div className="grid grid-cols-2 gap-3">
                  <Field label={t('connections.name')} required>
                    <input
                      className="rl-input"
                      placeholder={t('connections.namePlaceholder')}
                      value={form.name}
                      onChange={(e) => setForm({ ...form, name: e.target.value })}
                    />
                  </Field>
                  <Field label={t('connections.env')}>
                    <select
                      className="rl-select"
                      value={form.env}
                      onChange={(e) => setForm({ ...form, env: e.target.value as ConnectionEnv })}
                    >
                      <option value={ConnectionEnv.EnvProduction}>
                        {t('connections.envProd')}
                      </option>
                      <option value={ConnectionEnv.EnvTest}>{t('connections.envTest')}</option>
                      <option value={ConnectionEnv.EnvDevelopment}>
                        {t('connections.envDev')}
                      </option>
                    </select>
                  </Field>
                  <div className="col-span-2">
                    <div className="mb-1.5 flex items-center justify-between gap-2">
                      <div className="rl-muted text-[11.5px]">
                        {t('connections.nameServer')}
                        <span className="text-destructive"> *</span>
                      </div>
                      <button
                        type="button"
                        className="rl-btn rl-btn-ghost rl-btn-sm h-6 px-1.5 text-[11px] text-muted-foreground"
                        onClick={() =>
                          setForm({
                            ...form,
                            nsEntries: [...form.nsEntries, { host: '', port: DEFAULT_NS_PORT }],
                          })
                        }
                      >
                        <Plus size={12} />
                        {t('connections.addNameServer')}
                      </button>
                    </div>
                    <div className="flex flex-col gap-2">
                      {form.nsEntries.map((entry, index) => (
                        <div key={index} className="flex items-center gap-2">
                          <div className="min-w-0 flex-1">
                            <input
                              className="rl-input font-mono-design"
                              placeholder={t('connections.hostPlaceholder')}
                              value={entry.host}
                              onChange={(e) =>
                                setForm({
                                  ...form,
                                  nsEntries: updateNsEntry(form.nsEntries, index, {
                                    host: e.target.value,
                                  }),
                                })
                              }
                              aria-label={t('connections.host')}
                            />
                          </div>
                          <span className="rl-muted shrink-0 select-none text-[12px]">:</span>
                          <input
                            className="rl-input font-mono-design shrink-0 text-center"
                            style={{ width: 92, minWidth: 92, maxWidth: 92 }}
                            type="text"
                            inputMode="numeric"
                            pattern="[0-9]*"
                            maxLength={5}
                            placeholder={DEFAULT_NS_PORT}
                            value={entry.port}
                            onChange={(e) =>
                              setForm({
                                ...form,
                                nsEntries: updateNsEntry(form.nsEntries, index, {
                                  port: e.target.value.replace(/\D/g, '').slice(0, 5),
                                }),
                              })
                            }
                            aria-label={t('connections.port')}
                          />
                          {form.nsEntries.length > 1 && (
                            <button
                              type="button"
                              className="rl-btn rl-btn-ghost rl-btn-icon rl-btn-sm shrink-0 text-muted-foreground"
                              title={t('common.delete')}
                              onClick={() =>
                                setForm({
                                  ...form,
                                  nsEntries: form.nsEntries.filter((_, i) => i !== index),
                                })
                              }
                            >
                              <X size={13} />
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                    <div className="rl-muted mt-1.5 text-[11px]">
                      {t('connections.nameServerHint')}
                    </div>
                  </div>
                </div>

                {/* Advanced (timeout / ACL / remark) */}
                <button
                  type="button"
                  className="rl-muted mt-4 flex w-full items-center gap-1 border-0 bg-transparent p-0 text-left text-[12px] hover:text-foreground"
                  onClick={() => setAdvancedOpen((v) => !v)}
                >
                  {advancedOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  {t('connections.advanced')}
                </button>
                {advancedOpen && (
                  <div className="mt-3 grid grid-cols-2 gap-3 border-t border-border pt-3">
                    <Field label={t('connections.timeout')}>
                      <div className="flex items-center gap-2">
                        <input
                          className="rl-input"
                          type="number"
                          min={1}
                          max={300}
                          value={form.timeoutSec}
                          onChange={(e) =>
                            setForm({ ...form, timeoutSec: Number(e.target.value) || 1 })
                          }
                        />
                        <span className="rl-muted shrink-0 text-[12px]">
                          {t('connections.timeoutUnit')}
                        </span>
                      </div>
                    </Field>
                    <div className="col-span-2">
                      <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0">
                          <div className="text-[12.5px] font-medium">
                            {t('connections.enableAcl')}
                          </div>
                          <div className="rl-muted mt-0.5 text-[11.5px]">
                            {t('connections.enableAclHint')}
                          </div>
                        </div>
                        <button
                          type="button"
                          role="switch"
                          aria-checked={form.enableACL}
                          onClick={() => setForm({ ...form, enableACL: !form.enableACL })}
                          className={cn('rl-switch', form.enableACL && 'on')}
                        />
                      </div>
                      {form.enableACL && (
                        <div className="mt-3 grid grid-cols-2 gap-3">
                          <Field label={t('connections.ak')}>
                            <input
                              className="rl-input font-mono-design"
                              value={form.accessKey}
                              onChange={(e) => setForm({ ...form, accessKey: e.target.value })}
                            />
                          </Field>
                          <Field label={t('connections.sk')}>
                            <input
                              className="rl-input font-mono-design"
                              type="password"
                              value={form.secretKey}
                              onChange={(e) => setForm({ ...form, secretKey: e.target.value })}
                            />
                          </Field>
                        </div>
                      )}
                    </div>
                    <div className="col-span-2">
                      <Field label={t('connections.remark')}>
                        <input
                          className="rl-input"
                          placeholder={t('connections.remarkPlaceholder')}
                          value={form.remark}
                          onChange={(e) => setForm({ ...form, remark: e.target.value })}
                        />
                      </Field>
                    </div>
                  </div>
                )}

                {/* Secondary actions */}
                <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-border pt-3">
                  <button
                    type="button"
                    className="rl-btn rl-btn-ghost rl-btn-sm text-muted-foreground"
                    onClick={handleTest}
                    disabled={anyBusy}
                  >
                    {busy === 'test' ? <Spinner size={12} /> : <Wifi size={12} />}
                    {busy === 'test' ? t('connections.testing') : t('connections.test')}
                  </button>
                  {!isNew && selected && !selected.isDefault && (
                    <button
                      type="button"
                      className="rl-btn rl-btn-ghost rl-btn-sm text-muted-foreground"
                      onClick={handleSetDefault}
                      disabled={anyBusy}
                    >
                      <Star size={12} />
                      {t('connections.setDefault')}
                    </button>
                  )}
                  {!isNew && selected && (
                    <button
                      type="button"
                      className="rl-btn rl-btn-ghost rl-btn-sm text-destructive"
                      onClick={() => setConfirmDelete(selected)}
                      disabled={anyBusy}
                    >
                      <Trash2 size={12} />
                      {t('common.delete')}
                    </button>
                  )}
                  <div className="ml-auto" />
                  {/* Save only when dirty and not using connect as save path, or when online (edit without reconnect) */}
                  {(dirty || isNew) && (
                    <button
                      type="button"
                      className="rl-btn rl-btn-outline rl-btn-sm"
                      onClick={handleSaveOnly}
                      disabled={anyBusy || (!isNew && !dirty)}
                    >
                      {busy === 'save' ? <Spinner size={12} /> : <Check size={12} />}
                      {isNew ? t('connections.saveOnly') : t('connections.save')}
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={confirmDelete != null}
        title={t('connections.deleteBtn')}
        description={t('connections.deleteConfirm', { name: confirmDelete?.name ?? '' })}
        confirmText={t('common.delete')}
        cancelText={t('common.cancel')}
        variant="destructive"
        onConfirm={handleDelete}
        onCancel={() => setConfirmDelete(null)}
      />
    </div>
  )
}

function Field({
  label,
  required,
  children,
}: {
  label: string
  required?: boolean
  children: React.ReactNode
}) {
  return (
    <div>
      <div className="rl-muted mb-1.5 text-[11.5px]">
        {label}
        {required && <span className="text-destructive"> *</span>}
      </div>
      {children}
    </div>
  )
}
