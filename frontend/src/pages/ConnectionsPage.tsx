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
import { PageHeader } from '@/components/PageHeader'
import { EmptyState } from '@/components/EmptyState'
import { PageBody } from '@/components/PageLayout'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { useConnections } from '@/hooks/useConnections'
import * as connectionApi from '@/api/connection'
import { formatErrorMessage, cn } from '@/lib/utils'
import { activatableRowProps, ROW_FOCUS_CLASS } from '@/lib/a11y'
import { ConnectionEnv, type Connection } from '@/api/models'
import {
  hasConnectionPrefill,
  takeConnectionPrefill,
  type ConnectionPrefill,
} from '@/lib/connectionPrefill'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { Card } from '@/components/ui/card'

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
  accessKeyConfigured: boolean
  secretKeyConfigured: boolean
  remark: string
}

/**
 * Keep only characters that can legally appear in a NameServer host —
 * hostname / IPv4 / IPv6 literal. Strips spaces, CJK, and other junk as
 * the user types so the field cannot hold an unparseable address.
 */
function sanitizeHost(raw: string): string {
  return raw.replace(/[^0-9A-Za-z.:_\-[\]]/g, '')
}

function isIPv4(s: string): boolean {
  const m = s.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (!m) return false
  return m.slice(1, 5).every((o) => Number(o) <= 255)
}

function isIPv6(s: string): boolean {
  const inner = s.replace(/^\[/, '').replace(/\]$/, '')
  if (!inner.includes(':')) return false
  if ((inner.match(/::/g) ?? []).length > 1) return false
  const groups = inner.split(':')
  const nonEmpty = groups.filter((g) => g !== '')
  if (nonEmpty.some((g) => !/^[0-9a-fA-F]{1,4}$/.test(g))) return false
  return inner.includes('::') ? nonEmpty.length <= 7 : groups.length === 8
}

function isHostname(s: string): boolean {
  if (s.length > 253) return false
  const host = s.endsWith('.') ? s.slice(0, -1) : s
  if (!host) return false
  return host
    .split('.')
    .every((label) => /^[A-Za-z0-9_](?:[A-Za-z0-9_-]{0,61}[A-Za-z0-9_])?$/.test(label))
}

/**
 * A NameServer host is valid when it is a real IPv4, an IPv6 literal, or a
 * hostname / domain. A string of only digits and dots must be a valid IPv4 —
 * this is what rejects near-misses like "192.168.2123" instead of accepting
 * them as an all-numeric hostname.
 */
function isValidNsHost(raw: string): boolean {
  const s = raw.trim()
  if (!s) return false
  if (s.startsWith('[') || s.includes(':')) return isIPv6(s)
  if (/^[\d.]+$/.test(s)) return isIPv4(s)
  return isHostname(s)
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
  env: ConnectionEnv.Test,
  nsEntries: [{ host: '', port: DEFAULT_NS_PORT }],
  timeoutSec: 5,
  enableACL: false,
  accessKey: '',
  secretKey: '',
  accessKeyConfigured: false,
  secretKeyConfigured: false,
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
    accessKeyConfigured: c.accessKeyConfigured,
    secretKeyConfigured: c.secretKeyConfigured,
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

function EnvBadge({ env }: { env: ConnectionEnv }) {
  const { t } = useTranslation()
  const meta = {
    [ConnectionEnv.Production]: { variant: 'destructive', labelKey: 'connections.envProd' },
    [ConnectionEnv.Test]: { variant: 'warning', labelKey: 'connections.envTest' },
    [ConnectionEnv.Development]: { variant: 'info', labelKey: 'connections.envDev' },
    [ConnectionEnv.Unset]: { variant: 'info', labelKey: 'connections.envDev' },
  } as const
  const m = meta[env] ?? meta[ConnectionEnv.Development]
  return (
    <Badge variant={m.variant} uppercase>
      {t(m.labelKey)}
    </Badge>
  )
}

export function ConnectionsPage() {
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
  // NameServer host inputs flagged invalid on blur (keyed by entry index).
  const [hostErrors, setHostErrors] = useState<Record<number, boolean>>({})
  // Guards against React Strict Mode double-effect wiping a just-applied prefill
  const newFormCycle = useRef(0)
  const appliedNewCycle = useRef(-1)
  // Which connection the form currently holds. useConnections re-polls every
  // 30s and hands back fresh objects, so hydration keys off this instead of the
  // selected object's identity — otherwise the poll would overwrite whatever
  // the user is typing.
  const hydratedRef = useRef<{ id: number; token: number } | null>(null)
  // Bumped after a save so the form deliberately re-reads the stored record.
  const [resyncToken, setResyncToken] = useState(0)

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
      hydratedRef.current = { id: NEW_FORM_ID, token: resyncToken }
      // Clear stale validation flags whenever the edited connection changes.
      setHostErrors({})
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
    if (!selected) return
    const hydrated = hydratedRef.current
    // Same connection, same save generation: the list just re-polled and the
    // form is already showing this record (possibly with unsaved edits).
    if (hydrated && hydrated.id === selected.id && hydrated.token === resyncToken) return
    hydratedRef.current = { id: selected.id, token: resyncToken }
    setHostErrors({})
    const next = fromConnection(selected)
    setForm(next)
    setOriginalForm(next)
    setAdvancedOpen(selected.enableACL || selected.timeoutSec !== 5 || !!selected.remark)
  }, [selected, selectedId, resyncToken])

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
    if (f.enableACL) {
      const accessKey = f.accessKey.trim()
      const secretKey = f.secretKey.trim()
      const replacingCredentials = accessKey !== '' || secretKey !== ''
      if (
        (replacingCredentials && (!accessKey || !secretKey)) ||
        (!replacingCredentials && (!f.accessKeyConfigured || !f.secretKeyConfigured))
      ) {
        return t('connections.validateAcl')
      }
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
      // The edit landed, so re-reading the stored record is wanted here: it
      // picks up server-side normalisation and clears the dirty state.
      setResyncToken((token) => token + 1)
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
          <div className="relative" style={{ width: '13.85rem' }}>
            <span className="pointer-events-none absolute left-2.5 top-1/2 z-[1] -translate-y-1/2 text-muted-foreground">
              <Search size={13} />
            </span>
            <Input
              className="pl-8"
              placeholder={t('connections.searchPlaceholder')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        )}
        <Button variant="default" size="sm" onClick={handleNew}>
          <Plus size={13} />
          {t('common.create')}
        </Button>
      </PageHeader>

      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* List */}
        <div className="scroll-thin flex w-[20.92rem] shrink-0 flex-col border-r border-border bg-background">
          <div className="scroll-thin min-h-0 flex-1 overflow-auto p-3">
            {loading && list.length === 0 ? (
              <div className="text-muted-foreground flex items-center justify-center gap-2 p-8">
                <Spinner size={14} />
                <span className="text-fs-12">{t('common.loading')}</span>
              </div>
            ) : filtered.length === 0 ? (
              <EmptyState
                title={t('connections.empty')}
                description={t('connections.emptyHint')}
                actionLabel={t('connections.addFirst')}
                onAction={handleNew}
              />
            ) : (
              <div className="flex flex-col gap-2">
                {filtered.map((c) => {
                  const active = selectedId === c.id
                  const online = c.status === 'online'
                  const rowBusy =
                    busyId === c.id && (busy === 'row-connect' || busy === 'row-disconnect')
                  return (
                    <div
                      key={c.id}
                      role="button"
                      aria-current={active || undefined}
                      className={cn(
                        'group flex cursor-pointer flex-col gap-1 rounded-[10px] border px-3 py-2.5 transition-colors',
                        ROW_FOCUS_CLASS,
                        active
                          ? 'border-foreground/30 bg-accent'
                          : 'border-border hover:bg-accent/70',
                      )}
                      onClick={() => handleSelect(c)}
                      {...activatableRowProps(() => handleSelect(c))}
                    >
                      <div className="flex items-center gap-2">
                        <span
                          className="h-[7px] w-[7px] shrink-0 rounded-full"
                          style={{
                            background: online
                              ? 'hsl(var(--success))'
                              : 'hsl(var(--muted-foreground) / 0.35)',
                          }}
                        />
                        <span className="min-w-0 flex-1 truncate text-fs-125 font-medium">
                          {c.name}
                        </span>
                        {c.isDefault && (
                          <Badge variant="outline" uppercase className="text-muted-foreground">
                            {t('connections.default')}
                          </Badge>
                        )}
                        <Button
                          type="button"
                          variant={online ? 'outline' : 'default'}
                          size="sm"
                          className="h-6 shrink-0 px-2"
                          disabled={anyBusy}
                          title={online ? t('connections.disconnect') : t('connections.connect')}
                          onClick={(e) =>
                            online ? handleRowDisconnect(c, e) : handleRowConnect(c, e)
                          }
                        >
                          {rowBusy ? (
                            <Spinner size={12} />
                          ) : online ? (
                            <Unlink size={12} />
                          ) : (
                            <PlugZap size={12} />
                          )}
                        </Button>
                      </div>
                      <div className="flex items-center gap-1.5 pl-[15px]">
                        <EnvBadge env={c.env} />
                        <span className="font-mono-design text-muted-foreground min-w-0 truncate text-fs-105">
                          {c.nameServer || '—'}
                        </span>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>

        {/* Detail */}
        <PageBody width="form">
          {selectedId == null ? (
            <EmptyState icon={PlugZap} title={t('connections.selectHint')} />
          ) : (
            <div>
              {/* Header + primary action */}
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="truncate text-fs-15 font-semibold tracking-tight">
                      {isNew ? t('connections.newTitle') : selected?.name || form.name}
                    </h2>
                    {!isNew &&
                      selected &&
                      (isOnline ? (
                        <Badge variant="success">
                          <span className="h-1.5 w-1.5 rounded-full bg-current" />
                          {t('common.connected')}
                        </Badge>
                      ) : (
                        <Badge variant="outline">{t('common.offline')}</Badge>
                      ))}
                    {dirty && !isNew && (
                      <span className="text-muted-foreground text-fs-11">{t('connections.unsaved')}</span>
                    )}
                  </div>
                  <div className="text-muted-foreground mt-1 text-fs-115">
                    {isNew
                      ? t('connections.connectHintNew')
                      : isOnline
                        ? t('connections.connectHintOnline')
                        : t('connections.connectHint')}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  {isOnline && !isNew ? (
                    <Button variant="outline" size="sm"
                      onClick={handleDisconnectPrimary}
                      disabled={primaryBusy}
                    >
                      {busy === 'disconnect' ? <Spinner size={13} /> : <Unlink size={13} />}
                      {t('connections.disconnect')}
                    </Button>
                  ) : (
                    <Button variant="default" size="sm"
                      onClick={handleConnectPrimary}
                      disabled={primaryBusy}
                    >
                      {busy === 'connect' ? <Spinner size={13} /> : <PlugZap size={13} />}
                      {isNew
                        ? t('connections.saveAndConnect')
                        : dirty
                          ? t('connections.saveAndConnect')
                          : t('connections.connect')}
                    </Button>
                  )}
                </div>
              </div>

              <Card className="p-4">
                <div className="grid grid-cols-2 gap-3">
                  <Field label={t('connections.name')} required>
                    <Input
                      placeholder={t('connections.namePlaceholder')}
                      value={form.name}
                      onChange={(e) => setForm({ ...form, name: e.target.value })}
                    />
                  </Field>
                  <Field label={t('connections.env')}>
                    <Select
                      value={form.env}
                      onChange={(e) => setForm({ ...form, env: e.target.value as ConnectionEnv })}
                    >
                      <option value={ConnectionEnv.Production}>
                        {t('connections.envProd')}
                      </option>
                      <option value={ConnectionEnv.Test}>{t('connections.envTest')}</option>
                      <option value={ConnectionEnv.Development}>
                        {t('connections.envDev')}
                      </option>
                    </Select>
                  </Field>
                  <div className="col-span-2">
                    <div className="mb-1.5 flex items-center justify-between gap-2">
                      <div className="text-muted-foreground text-fs-115">
                        {t('connections.nameServer')}
                        <span className="text-destructive"> *</span>
                      </div>
                      <Button variant="ghost" size="sm"
                        type="button"
                        className="h-6 px-1.5 text-fs-11 text-muted-foreground"
                        onClick={() =>
                          setForm({
                            ...form,
                            nsEntries: [...form.nsEntries, { host: '', port: DEFAULT_NS_PORT }],
                          })
                        }
                      >
                        <Plus size={12} />
                        {t('connections.addNameServer')}
                      </Button>
                    </div>
                    <div className="flex flex-col gap-2">
                      {form.nsEntries.map((entry, index) => (
                        <div key={index} className="flex flex-col gap-1">
                          <div className="flex items-center gap-2">
                            <div className="min-w-0 flex-1">
                              <Input
                                className={cn(
                                  'font-mono-design',
                                  hostErrors[index] &&
                                    'border-destructive focus-visible:border-destructive focus-visible:ring-destructive/25',
                                )}
                                placeholder={t('connections.hostPlaceholder')}
                                value={entry.host}
                                maxLength={253}
                                spellCheck={false}
                                autoComplete="off"
                                aria-invalid={hostErrors[index] || undefined}
                                onChange={(e) => {
                                  if (hostErrors[index]) {
                                    setHostErrors((prev) => ({ ...prev, [index]: false }))
                                  }
                                  setForm({
                                    ...form,
                                    nsEntries: updateNsEntry(form.nsEntries, index, {
                                      host: sanitizeHost(e.target.value),
                                    }),
                                  })
                                }}
                                onBlur={() =>
                                  setHostErrors((prev) => ({
                                    ...prev,
                                    [index]: entry.host.trim() !== '' && !isValidNsHost(entry.host),
                                  }))
                                }
                                aria-label={t('connections.host')}
                              />
                            </div>
                            <span className="text-muted-foreground shrink-0 select-none text-fs-12">
                              :
                            </span>
                            <Input
                              className="font-mono-design shrink-0 text-center"
                              style={{ width: '7.08rem', minWidth: '7.08rem', maxWidth: '7.08rem' }}
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
                              <Button variant="ghost" size="icon-sm"
                                type="button"
                                className="shrink-0 text-muted-foreground"
                                title={t('common.delete')}
                                onClick={() => {
                                  setHostErrors({})
                                  setForm({
                                    ...form,
                                    nsEntries: form.nsEntries.filter((_, i) => i !== index),
                                  })
                                }}
                              >
                                <X size={13} />
                              </Button>
                            )}
                          </div>
                          {hostErrors[index] && (
                            <span className="text-destructive text-fs-11">
                              {t('connections.hostInvalid')}
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                    <div className="text-muted-foreground mt-1.5 text-fs-11">
                      {t('connections.nameServerHint')}
                    </div>
                  </div>
                </div>

                {/* Advanced (timeout / ACL / remark) */}
                <button
                  type="button"
                  className="text-muted-foreground mt-4 flex w-full items-center gap-1 border-0 bg-transparent p-0 text-left text-fs-12 hover:text-foreground"
                  onClick={() => setAdvancedOpen((v) => !v)}
                >
                  {advancedOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                  {t('connections.advanced')}
                </button>
                {advancedOpen && (
                  <div className="mt-3 grid grid-cols-2 gap-3 border-t border-border pt-3">
                    <Field label={t('connections.timeout')}>
                      <div className="flex items-center gap-2">
                        <Input
                          type="number"
                          min={1}
                          max={300}
                          value={form.timeoutSec}
                          onChange={(e) =>
                            setForm({ ...form, timeoutSec: Number(e.target.value) || 1 })
                          }
                        />
                        <span className="text-muted-foreground shrink-0 text-fs-12">
                          {t('connections.timeoutUnit')}
                        </span>
                      </div>
                    </Field>
                    <div className="col-span-2">
                      <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0">
                          <div className="text-fs-125 font-medium">
                            {t('connections.enableAcl')}
                          </div>
                          <div className="text-muted-foreground mt-0.5 text-fs-115">
                            {t('connections.enableAclHint')}
                          </div>
                        </div>
                        <Switch
                          checked={form.enableACL}
                          onCheckedChange={(v) => setForm({ ...form, enableACL: v })}
                        />
                      </div>
                      {form.enableACL && (
                        <div className="mt-3 grid grid-cols-2 gap-3">
                          <Field label={t('connections.ak')}>
                            <Input
                              className="font-mono-design"
                              value={form.accessKey}
                              placeholder={form.accessKeyConfigured ? '••••••••' : t('connections.ak')}
                              onChange={(e) => setForm({ ...form, accessKey: e.target.value })}
                            />
                          </Field>
                          <Field label={t('connections.sk')}>
                            <Input
                              className="font-mono-design"
                              type="password"
                              value={form.secretKey}
                              placeholder={form.secretKeyConfigured ? '••••••••' : t('connections.sk')}
                              onChange={(e) => setForm({ ...form, secretKey: e.target.value })}
                            />
                          </Field>
                        </div>
                      )}
                    </div>
                    <div className="col-span-2">
                      <Field label={t('connections.remark')}>
                        <Input
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
                  <Button variant="ghost" size="sm"
                    type="button"
                    className="text-muted-foreground"
                    onClick={handleTest}
                    disabled={anyBusy}
                  >
                    {busy === 'test' ? <Spinner size={12} /> : <Wifi size={12} />}
                    {busy === 'test' ? t('connections.testing') : t('connections.test')}
                  </Button>
                  {!isNew && selected && !selected.isDefault && (
                    <Button variant="ghost" size="sm"
                      type="button"
                      className="text-muted-foreground"
                      onClick={handleSetDefault}
                      disabled={anyBusy}
                    >
                      <Star size={12} />
                      {t('connections.setDefault')}
                    </Button>
                  )}
                  {!isNew && selected && (
                    <Button variant="ghost" size="sm"
                      type="button"
                      className="text-destructive"
                      onClick={() => setConfirmDelete(selected)}
                      disabled={anyBusy}
                    >
                      <Trash2 size={12} />
                      {t('common.delete')}
                    </Button>
                  )}
                  <div className="ml-auto" />
                  {/* Save only when dirty and not using connect as save path, or when online (edit without reconnect) */}
                  {(dirty || isNew) && (
                    <Button variant="outline" size="sm"
                      type="button"
                      onClick={handleSaveOnly}
                      disabled={anyBusy || (!isNew && !dirty)}
                    >
                      {busy === 'save' ? <Spinner size={12} /> : <Check size={12} />}
                      {isNew ? t('connections.saveOnly') : t('connections.save')}
                    </Button>
                  )}
                </div>
              </Card>
            </div>
          )}
        </PageBody>
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
      <div className="text-muted-foreground mb-1.5 text-fs-115">
        {label}
        {required && <span className="text-destructive"> *</span>}
      </div>
      {children}
    </div>
  )
}
