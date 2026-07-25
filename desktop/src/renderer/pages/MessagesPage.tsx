import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Search, Copy, X, Send, GitBranch, Check } from 'lucide-react'
import { Spinner } from '@/components/Spinner'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import type { MessageItem, MessageTrackItem } from '@generated/models'
import { PageHeader } from '@/components/PageHeader'
import { JsonView } from '@/components/JsonView'
import { useTopics } from '@/hooks/useTopics'
import { useConsumers } from '@/hooks/useConsumers'
import { useSettings } from '@/hooks/useSettings'
import { useDelayedUnmount } from '@/hooks/useDelayedUnmount'
import * as messageApi from '@/api/message'
import { formatErrorMessage } from '@/lib/utils'
import { activatableRowProps, ROW_FOCUS_CLASS } from '@/lib/a11y'
import {
  detectBodyKind,
  formatMessageTime,
  toHexDump,
  truncatePayload,
  type BodyPreviewKind,
} from '@/lib/time'
import { SlidingTabs } from '@/components/SlidingTabs'
import { OfflineEmpty } from '@/components/OfflineEmpty'
import { ErrorBanner } from '@/components/ErrorBanner'
import type { NavId } from '@/layout/Sidebar'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { Modal } from '@/components/ui/modal'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table'

type TabKey = 'topic' | 'msgid' | 'retry' | 'dlq'

function tryFormatJSON(s: string): string {
  try {
    return JSON.stringify(JSON.parse(s), null, 2)
  } catch {
    return s
  }
}

export function MessagesPage({ onNavigate }: { onNavigate?: (id: NavId) => void }) {
  const { t } = useTranslation()
  const { topics, hasOnline } = useTopics()
  const { groups: consumerGroups } = useConsumers()
  const { settings } = useSettings()
  const [tab, setTab] = useState<TabKey>('topic')

  // Form state per tab
  const [topic, setTopic] = useState<string>('')
  const [msgId, setMsgId] = useState<string>('')
  const [keyFilter, setKeyFilter] = useState<string>('')
  const [tagFilter, setTagFilter] = useState<string>('')
  const [beginAt, setBeginAt] = useState<string>('')
  const [endAt, setEndAt] = useState<string>('')
  const [group, setGroup] = useState<string>('')
  const [limit, setLimit] = useState<number>(settings.fetchLimit || 32)

  // Result state
  const [results, setResults] = useState<MessageItem[]>([])
  const [searching, setSearching] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [hasSearched, setHasSearched] = useState(false)
  const searchRequestRef = useRef(0)

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [resendTarget, setResendTarget] = useState<MessageItem | null>(null)

  const sendableTopics = useMemo(
    () =>
      topics
        .filter((tp) => !tp.topic.startsWith('%RETRY%') && !tp.topic.startsWith('%DLQ%'))
        .map((tp) => tp.topic)
        .sort(),
    [topics],
  )
  const sortedGroups = useMemo(() => consumerGroups.map((g) => g.group).sort(), [consumerGroups])

  const selected = useMemo(
    () => results.find((m) => m.messageId === selectedId) ?? null,
    [results, selectedId],
  )

  // Selection is set inline by handleSearch (and cleared by close).
  // No effect needed — that would cause the close button to re-select instantly.

  const dismissPanel = useCallback(() => setSelectedId(null), [])

  const panelMount = useDelayedUnmount(!!selected)
  // Pin the displayed item so it stays alive during the exit animation.
  const [pinnedSelected, setPinnedSelected] = useState<MessageItem | null>(null)
  useEffect(() => {
    if (selected) setPinnedSelected(selected)
  }, [selected])
  const renderedSelected = selected ?? pinnedSelected

  // Esc closes the detail panel
  useEffect(() => {
    if (!selectedId) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') dismissPanel()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [selectedId, dismissPanel])

  // Clicking the result pane outside any row closes the panel
  const handleListBackgroundClick = (e: React.MouseEvent) => {
    if (!selectedId) return
    if ((e.target as HTMLElement).closest('tr')) return
    dismissPanel()
  }

  const handleSearch = async () => {
    const requestId = ++searchRequestRef.current
    setError(null)
    setHasSearched(true)
    if (tab === 'topic' || tab === 'msgid') {
      if (!topic) {
        setError(t('messages.form.validateTopic'))
        return
      }
      if (tab === 'msgid' && !msgId.trim()) {
        setError(t('messages.form.validateMsgId'))
        return
      }
    } else {
      if (!group) {
        setError(t('messages.form.validateGroup'))
        return
      }
    }
    setSearching(true)
    setResults([])
    try {
      let next: MessageItem[] = []
      if (tab === 'topic') {
        const beginMs = beginAt ? new Date(beginAt).getTime() : 0
        const endMs = endAt ? new Date(endAt).getTime() : 0
        if (
          (beginAt && Number.isNaN(beginMs)) ||
          (endAt && Number.isNaN(endMs)) ||
          (beginMs > 0 && endMs > 0 && beginMs > endMs)
        ) {
          setError(t('messages.form.validateTimeRange'))
          return
        }
        next = await messageApi.queryMessagesByCondition(
          topic,
          {
            messageKey: keyFilter,
            messageTag: tagFilter,
            startTimeMs: beginMs,
            endTimeMs: endMs,
          },
          limit,
        )
      } else if (tab === 'msgid') {
        next = await messageApi.queryMessagesByCondition(topic, { messageId: msgId.trim() })
      } else if (tab === 'retry') {
        next = await messageApi.queryRetryMessages(group, limit)
      } else if (tab === 'dlq') {
        next = await messageApi.queryDLQMessages(group, limit)
      }
      if (requestId !== searchRequestRef.current) return
      setResults(next)
      // Keep the detail panel closed after a new query — the user
      // opens it explicitly by clicking a row.
      setSelectedId(null)
      if (next.length === 0) {
        toast.info(t('messages.empty'))
      }
    } catch (e) {
      if (requestId !== searchRequestRef.current) return
      const msg = formatErrorMessage(e)
      setError(msg)
      toast.error(t('messages.queryError', { message: msg }))
    } finally {
      if (requestId === searchRequestRef.current) setSearching(false)
    }
  }

  const handleCopy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      toast.success(t('messages.detail.copySuccess'))
    } catch {
      toast.error(t('messages.detail.copyError'))
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        title={t('messages.title')}
        subtitle={!hasOnline ? t('messages.subtitleNoConn') : undefined}
      />

      {hasOnline && (
        <div className="flex items-center gap-1 border-b border-border px-4 py-2">
          <SlidingTabs
            value={tab}
            onChange={(key) => {
              searchRequestRef.current += 1
              setTab(key)
              setResults([])
              setError(null)
              setHasSearched(false)
            }}
            items={[
              { key: 'topic', label: t('messages.tabs.topic') },
              { key: 'msgid', label: t('messages.tabs.msgid') },
              { key: 'retry', label: t('messages.tabs.retry') },
              { key: 'dlq', label: t('messages.tabs.dlq') },
            ]}
          />
        </div>
      )}

      {!hasOnline ? (
        <OfflineEmpty
          message={t('messages.subtitleNoConn')}
          className="flex-1"
          onAction={() => onNavigate?.('connections')}
        />
      ) : (
        <>
          {/* Query bar */}
          <div className="mx-5 mt-3 flex flex-wrap items-center gap-2 rounded-xl border border-border/80 bg-card p-3 shadow-card">
            {(tab === 'topic' || tab === 'msgid') && (
              <Select
                className="font-mono-design"
                style={{ width: 220 }}
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
              >
                <option value="">{t('messages.form.topicPlaceholder')}</option>
                {sendableTopics.map((tp) => (
                  <option key={tp} value={tp}>
                    {tp}
                  </option>
                ))}
              </Select>
            )}
            {(tab === 'retry' || tab === 'dlq') && (
              <Select
                className="font-mono-design"
                style={{ width: 240 }}
                value={group}
                onChange={(e) => setGroup(e.target.value)}
              >
                <option value="">{t('messages.form.groupPlaceholder')}</option>
                {sortedGroups.map((g) => (
                  <option key={g} value={g}>
                    {g}
                  </option>
                ))}
              </Select>
            )}

            {tab === 'topic' && (
              <>
                <Input
                  className="font-mono-design"
                  type="datetime-local"
                  placeholder={t('messages.form.begin')}
                  style={{ width: 200 }}
                  value={beginAt}
                  onChange={(e) => setBeginAt(e.target.value)}
                  title={t('messages.form.begin')}
                />
                <Input
                  className="font-mono-design"
                  type="datetime-local"
                  placeholder={t('messages.form.end')}
                  style={{ width: 200 }}
                  value={endAt}
                  onChange={(e) => setEndAt(e.target.value)}
                  title={t('messages.form.end')}
                />
                <Input
                  placeholder={t('messages.form.key')}
                  style={{ width: 140 }}
                  value={keyFilter}
                  onChange={(e) => setKeyFilter(e.target.value)}
                />
                <Input
                  placeholder={t('messages.form.tag')}
                  style={{ width: 120 }}
                  value={tagFilter}
                  onChange={(e) => setTagFilter(e.target.value)}
                />
              </>
            )}
            {tab === 'msgid' && (
              <Input
                className="font-mono-design"
                placeholder={t('messages.form.msgIdPlaceholder')}
                style={{ flex: 1, minWidth: 240 }}
                value={msgId}
                onChange={(e) => setMsgId(e.target.value)}
              />
            )}
            {(tab === 'topic' || tab === 'retry' || tab === 'dlq') && (
              <Input
                type="number"
                min={1}
                max={500}
                style={{ width: 90 }}
                value={limit}
                onChange={(e) => setLimit(Number(e.target.value) || 32)}
                title={t('messages.form.limit')}
              />
            )}
            <Button variant="default" size="sm"
              onClick={handleSearch}
              disabled={searching}
            >
              {searching ? <Spinner size={13} /> : <Search size={13} />}
              {searching ? t('messages.form.searching') : t('messages.form.search')}
            </Button>
            {hasSearched && !searching && results.length > 0 && (
              <div className="text-muted-foreground ml-auto text-fs-12">
                {t('messages.summary', { count: results.length })}
              </div>
            )}
          </div>

          {error && <ErrorBanner message={error} />}

          <div className="flex min-h-0 flex-1 overflow-hidden">
            <div
              className="scroll-thin min-w-0 flex-1 overflow-auto px-5 py-3"
              onClick={handleListBackgroundClick}
            >
              {searching && results.length === 0 ? (
                <div
                  className="text-muted-foreground flex items-center justify-center"
                  style={{ padding: 60, gap: 8 }}
                >
                  <Spinner size={14} />
                  <span className="text-fs-12">{t('messages.form.searching')}</span>
                </div>
              ) : !hasSearched ? (
                <div className="text-muted-foreground text-center text-fs-12" style={{ padding: 60 }}>
                  {t('messages.form.search')} →
                </div>
              ) : results.length === 0 ? (
                <div className="text-muted-foreground text-center text-fs-12" style={{ padding: 60 }}>
                  {t('messages.empty')}
                </div>
              ) : (
                <Card className="overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead style={{ width: 200 }}>{t('messages.table.msgId')}</TableHead>
                      <TableHead style={{ width: 110 }}>{t('messages.table.tag')}</TableHead>
                      <TableHead style={{ width: 180 }}>{t('messages.table.key')}</TableHead>
                      <TableHead>{t('messages.table.preview')}</TableHead>
                      <TableHead style={{ width: 70, textAlign: 'right' }}>{t('messages.table.queue')}</TableHead>
                      <TableHead style={{ width: 170 }}>{t('messages.table.storeTime')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {results.map((m) => (
                      <TableRow
                        key={m.messageId}
                        // A real <tr> keeps its row role; only the keyboard
                        // behaviour is borrowed from a button. The row used to
                        // carry a bare `selected` class that no stylesheet ever
                        // matched, so selection was invisible here.
                        data-state={selectedId === m.messageId ? 'selected' : undefined}
                        aria-selected={selectedId === m.messageId}
                        className={ROW_FOCUS_CLASS}
                        onClick={() => setSelectedId(m.messageId)}
                        {...activatableRowProps(() => setSelectedId(m.messageId))}
                        style={{ cursor: 'pointer' }}
                      >
                        <TableCell>
                          <div
                            className="font-mono-design truncate text-fs-12"
                            style={{ maxWidth: 180 }}
                            title={m.messageId}
                          >
                            {m.messageId.slice(0, 24)}…
                          </div>
                        </TableCell>
                        <TableCell>
                          {m.tags ? (
                            <Badge variant="outline">{m.tags}</Badge>
                          ) : (
                            <span className="text-muted-foreground text-fs-12">—</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <span className="font-mono-design text-fs-12">{m.keys || '—'}</span>
                        </TableCell>
                        <TableCell>
                          <div
                            className="font-mono-design text-muted-foreground text-fs-12"
                            style={{
                              maxWidth: 280,
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {m.body}
                          </div>
                        </TableCell>
                        <TableCell style={{ textAlign: 'right' }} className="tabular-nums text-muted-foreground">
                          {m.queueId}
                        </TableCell>
                        <TableCell className="font-mono-design text-muted-foreground text-fs-12">
                          {formatMessageTime(
                            m.storeTimestamp || m.storeTime,
                            settings.timezone,
                            settings.timestampFormat,
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                </Card>
              )}
            </div>

            {panelMount.shouldRender && renderedSelected && (
              <MessageDetailPanel
                msg={renderedSelected}
                exiting={panelMount.exiting}
                onClose={dismissPanel}
                onCopy={handleCopy}
                onResend={() => setResendTarget(renderedSelected)}
              />
            )}
          </div>
        </>
      )}

      {resendTarget && <ResendDialog msg={resendTarget} onClose={() => setResendTarget(null)} />}
    </div>
  )
}

// ---------- Detail Panel ----------

function MessageDetailPanel({
  msg,
  exiting,
  onClose,
  onCopy,
  onResend,
}: {
  msg: MessageItem
  exiting: boolean
  onClose: () => void
  onCopy: (s: string) => void
  onResend: () => void
}) {
  const { t } = useTranslation()
  const { settings } = useSettings()
  const [tab, setTab] = useState<'body' | 'properties' | 'track'>('body')
  const [bodyMode, setBodyMode] = useState<'auto' | 'raw' | 'hex'>('auto')
  const [track, setTrack] = useState<MessageTrackItem[] | null>(null)
  const [trackLoading, setTrackLoading] = useState(false)
  const [trackError, setTrackError] = useState<string | null>(null)

  // Reset to body tab when message changes
  useEffect(() => {
    setTab('body')
    setBodyMode('auto')
    setTrack(null)
    setTrackError(null)
  }, [msg.messageId])

  // Lazy-load track when track tab opens
  useEffect(() => {
    if (tab !== 'track' || track) return
    let cancelled = false
    setTrackLoading(true)
    setTrackError(null)
    messageApi
      .getMessageTrack(msg.topic, msg.messageId)
      .then((data) => {
        if (!cancelled) setTrack(data)
      })
      .catch((e) => {
        if (!cancelled) setTrackError(formatErrorMessage(e))
      })
      .finally(() => {
        if (!cancelled) setTrackLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [tab, track, msg.messageId, msg.topic])

  const payload = truncatePayload(msg.body || '', settings.maxPayloadRenderBytes || 512 * 1024)
  const detectedKind: BodyPreviewKind = detectBodyKind(payload.text)
  const displayBody = (() => {
    if (bodyMode === 'hex' || (bodyMode === 'auto' && detectedKind === 'binary')) {
      return toHexDump(payload.text)
    }
    if (bodyMode === 'auto' && detectedKind === 'json' && settings.autoFormatJson !== false) {
      return tryFormatJSON(payload.text)
    }
    if (bodyMode === 'auto' && settings.autoFormatJson !== false) {
      return tryFormatJSON(payload.text)
    }
    return payload.text
  })()
  const displayStoreTime = formatMessageTime(
    msg.storeTimestamp || msg.storeTime,
    settings.timezone,
    settings.timestampFormat,
  )

  const propEntries = Object.entries(msg.properties || {}).filter(
    ([, v]) => v !== undefined && v !== '',
  )

  return (
    <aside
      className={'scroll-thin detail-panel' + (exiting ? ' exiting' : '')}
      style={{
        width: 460,
        borderLeft: '1px solid hsl(var(--border))',
        overflow: 'auto',
        background: 'hsl(var(--background))',
      }}
    >
      <div style={{ padding: 20 }}>
        <div className="flex items-center justify-between gap-2">
          <div className="truncate font-semibold">{t('messages.detail.title')}</div>
          <div className="flex shrink-0 gap-1">
            <Button variant="ghost" size="icon-sm"
              onClick={() => onCopy(msg.messageId)}
              title={t('messages.detail.actions.copyId')}
            >
              <Copy size={13} />
            </Button>
            <Button variant="ghost" size="icon-sm" onClick={onClose}>
              <X size={14} />
            </Button>
          </div>
        </div>

        <div
          className="utabs"
          style={{
            marginTop: 12,
            marginLeft: -20,
            marginRight: -20,
            paddingLeft: 20,
            paddingRight: 20,
          }}
        >
          {(['body', 'properties', 'track'] as const).map((k) => (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={tab === k}
              className={'utab ' + (tab === k ? 'active' : '')}
              onClick={() => setTab(k)}
            >
              {t(`messages.detail.tabs.${k}`)}
            </button>
          ))}
        </div>

        <div className="mb-2.5 text-fs-11 font-semibold uppercase tracking-[0.08em] text-muted-foreground" style={{ marginTop: 16 }}>
          {t('messages.detail.info')}
        </div>
        <div>
          <div className="grid grid-cols-[120px_1fr] gap-3 border-b border-dashed border-border py-2 text-fs-13 last:border-b-0">
            <div className="text-muted-foreground">{t('messages.detail.msgId')}</div>
            <div className="text-foreground font-mono-design break-all text-fs-12">{msg.messageId}</div>
          </div>
          <div className="grid grid-cols-[120px_1fr] gap-3 border-b border-dashed border-border py-2 text-fs-13 last:border-b-0">
            <div className="text-muted-foreground">{t('messages.detail.topic')}</div>
            <div className="text-foreground font-mono-design text-fs-12">{msg.topic}</div>
          </div>
          {msg.tags && (
            <div className="grid grid-cols-[120px_1fr] gap-3 border-b border-dashed border-border py-2 text-fs-13 last:border-b-0">
              <div className="text-muted-foreground">{t('messages.detail.tag')}</div>
              <div className="text-foreground">{msg.tags}</div>
            </div>
          )}
          {msg.keys && (
            <div className="grid grid-cols-[120px_1fr] gap-3 border-b border-dashed border-border py-2 text-fs-13 last:border-b-0">
              <div className="text-muted-foreground">{t('messages.detail.key')}</div>
              <div className="text-foreground font-mono-design text-fs-12">{msg.keys}</div>
            </div>
          )}
          <div className="grid grid-cols-[120px_1fr] gap-3 border-b border-dashed border-border py-2 text-fs-13 last:border-b-0">
            <div className="text-muted-foreground">{t('messages.detail.queue')}</div>
            <div className="text-foreground tabular-nums">{msg.queueId}</div>
          </div>
          <div className="grid grid-cols-[120px_1fr] gap-3 border-b border-dashed border-border py-2 text-fs-13 last:border-b-0">
            <div className="text-muted-foreground">{t('messages.detail.queueOffset')}</div>
            <div className="text-foreground tabular-nums">{msg.queueOffset}</div>
          </div>
          {msg.bornHost && (
            <div className="grid grid-cols-[120px_1fr] gap-3 border-b border-dashed border-border py-2 text-fs-13 last:border-b-0">
              <div className="text-muted-foreground">{t('messages.detail.bornHost')}</div>
              <div className="text-foreground font-mono-design text-fs-12">{msg.bornHost}</div>
            </div>
          )}
          {msg.storeHost && (
            <div className="grid grid-cols-[120px_1fr] gap-3 border-b border-dashed border-border py-2 text-fs-13 last:border-b-0">
              <div className="text-muted-foreground">{t('messages.detail.storeHost')}</div>
              <div className="text-foreground font-mono-design text-fs-12">{msg.storeHost}</div>
            </div>
          )}
          <div className="grid grid-cols-[120px_1fr] gap-3 border-b border-dashed border-border py-2 text-fs-13 last:border-b-0">
            <div className="text-muted-foreground">{t('messages.detail.storeTime')}</div>
            <div className="text-foreground font-mono-design text-fs-12">{displayStoreTime}</div>
          </div>
          {msg.status && (
            <div className="grid grid-cols-[120px_1fr] gap-3 border-b border-dashed border-border py-2 text-fs-13 last:border-b-0">
              <div className="text-muted-foreground">{t('messages.detail.status')}</div>
              <div className="text-foreground">{msg.status}</div>
            </div>
          )}
          {msg.retryTimes > 0 && (
            <div className="grid grid-cols-[120px_1fr] gap-3 border-b border-dashed border-border py-2 text-fs-13 last:border-b-0">
              <div className="text-muted-foreground">{t('messages.detail.retryTimes')}</div>
              <div className="text-foreground tabular-nums">{msg.retryTimes}</div>
            </div>
          )}
        </div>

        {tab === 'body' && (
          <>
            <div
              className="mb-2 mt-5 flex items-center justify-between gap-2"
              style={{ marginTop: 20 }}
            >
              <div className="flex min-w-0 items-center gap-2">
                <div className="mb-2.5 text-fs-11 font-semibold uppercase tracking-[0.08em] text-muted-foreground" style={{ marginBottom: 0 }}>
                  {t('messages.detail.bodyTitle')}
                </div>
                <Badge variant="outline" className="text-fs-10">
                  {t(`messages.detail.bodyKind.${detectedKind}`)}
                </Badge>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                {(['auto', 'raw', 'hex'] as const).map((mode) => (
                  <Button
                    key={mode}
                    type="button"
                    variant="ghost"
                    size="sm"
                    className={
                      'h-6 px-1.5 text-fs-11 ' +
                      (bodyMode === mode ? 'text-foreground' : 'text-muted-foreground')
                    }
                    onClick={() => setBodyMode(mode)}
                  >
                    {t(`messages.detail.bodyMode.${mode}`)}
                  </Button>
                ))}
                <Button variant="ghost" size="sm" onClick={() => onCopy(msg.body)}>
                  <Copy size={12} />
                  {t('messages.detail.actions.copyBody')}
                </Button>
              </div>
            </div>
            {payload.truncated && (
              <div className="text-muted-foreground mb-2 text-fs-11" style={{ lineHeight: 1.5 }}>
                {t('messages.detail.bodyTruncated', {
                  shown: Math.round(settings.maxPayloadRenderBytes / 1024),
                  total: Math.round(payload.originalBytes / 1024),
                })}
              </div>
            )}
            <JsonView src={displayBody} maxHeight={300} />
          </>
        )}

        {tab === 'properties' && (
          <div className="mt-4">
            {propEntries.length === 0 ? (
              <div className="text-muted-foreground text-fs-12" style={{ padding: 16, textAlign: 'center' }}>
                {t('messages.detail.propsEmpty')}
              </div>
            ) : (
              <div>
                {propEntries.map(([k, v]) => (
                  <div className="grid grid-cols-[120px_1fr] gap-3 border-b border-dashed border-border py-2 text-fs-13 last:border-b-0" key={k}>
                    <div className="k font-mono-design">{k}</div>
                    <div className="text-foreground font-mono-design break-all text-fs-12">{String(v)}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {tab === 'track' && (
          <div className="mt-4">
            <div className="mb-2.5 text-fs-11 font-semibold uppercase tracking-[0.08em] text-muted-foreground">{t('messages.detail.trackTitle')}</div>
            {trackLoading ? (
              <div
                className="text-muted-foreground flex items-center justify-center"
                style={{ padding: 24, gap: 8 }}
              >
                <Spinner size={14} />
                <span className="text-fs-12">{t('messages.detail.trackLoading')}</span>
              </div>
            ) : trackError ? (
              <div
                className="text-fs-12"
                style={{ padding: 16, color: 'hsl(var(--destructive))' }}
              >
                {t('messages.detail.trackError')}: {trackError}
              </div>
            ) : !track || track.length === 0 ? (
              <div className="text-muted-foreground text-fs-12" style={{ padding: 16, textAlign: 'center' }}>
                {t('messages.detail.trackEmpty')}
              </div>
            ) : (
              <Card className="overflow-hidden">
                {track.map((tr, i) => (
                  <div
                    key={`${tr.consumerGroup}-${i}`}
                    style={{
                      padding: '10px 14px',
                      borderTop: i ? '1px solid hsl(var(--border))' : undefined,
                    }}
                  >
                    <div className="flex items-center gap-2">
                      <GitBranch size={11} className="text-muted-foreground" />
                      <span className="font-mono-design flex-1 text-fs-12">
                        {tr.consumerGroup}
                      </span>
                      {tr.trackType && (
                        <Badge
                          variant={
                            tr.trackType === 'CONSUMED'
                              ? 'success'
                              : tr.trackType === 'NOT_CONSUME_YET'
                                ? 'warning'
                                : 'outline'
                          }
                        >
                          {tr.trackType}
                        </Badge>
                      )}
                    </div>
                    {tr.consumeStatus && (
                      <div className="text-muted-foreground mt-1 text-fs-12">{tr.consumeStatus}</div>
                    )}
                    {tr.exceptionDesc && (
                      <div
                        className="mt-1 text-fs-11"
                        style={{ color: 'hsl(var(--destructive))' }}
                      >
                        {tr.exceptionDesc}
                      </div>
                    )}
                  </div>
                ))}
              </Card>
            )}
          </div>
        )}

        <div className="mt-6 flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={onResend}>
            <Send size={13} />
            {t('messages.detail.actions.resend')}
          </Button>
          <Button variant="outline" size="sm" onClick={() => setTab('track')}>
            <GitBranch size={13} />
            {t('messages.detail.actions.track')}
          </Button>
        </div>
      </div>
    </aside>
  )
}

// ---------- Resend dialog ----------

function ResendDialog({ msg, onClose }: { msg: MessageItem; onClose: () => void }) {
  const { t } = useTranslation()
  const [busy, setBusy] = useState(false)
  const targetTopic = msg.properties?.RETRY_TOPIC || msg.properties?.REAL_TOPIC || msg.topic

  const handleResend = async () => {
    setBusy(true)
    try {
      const result = await messageApi.resendMessage('', '', msg.topic, msg.messageId)
      toast.success(t('messages.detail.resendSuccess', { topic: targetTopic }), {
        description: result,
      })
      onClose()
    } catch (e) {
      toast.error(t('messages.detail.resendError'), {
        description: formatErrorMessage(e),
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open
      size="sm"
      title={t('messages.detail.resendTitle')}
      description={t('messages.detail.resendDesc', { topic: targetTopic })}
      dismissible={!busy}
      onClose={onClose}
      footer={
        <>
          <Button variant="outline" size="sm" type="button" onClick={onClose} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button variant="default" size="sm" type="button" onClick={handleResend} disabled={busy}>
            {busy ? <Spinner size={13} /> : <Check size={13} />}
            {t('messages.detail.resendSubmit')}
          </Button>
        </>
      }
    />
  )
}
