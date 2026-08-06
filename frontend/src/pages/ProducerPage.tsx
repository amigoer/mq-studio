import { useEffect, useMemo, useRef, useState } from 'react'
import { Send, RotateCcw, X, Check, AlertCircle } from 'lucide-react'
import { Spinner } from '@/components/Spinner'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { PageHeader } from '@/components/PageHeader'
import { PageBody } from '@/components/PageLayout'
import { useConnections } from '@/hooks/useConnections'
import { useRecentPicks } from '@/hooks/useRecentPicks'
import { useTopics } from '@/hooks/useTopics'
import * as messageApi from '@/api/message'
import { clearProducerDraft, loadProducerScope, saveProducerDraft } from '@/lib/producerDrafts'
import { formatErrorMessage } from '@/lib/utils'
import { EmptyState } from '@/components/EmptyState'
import { OfflineEmpty } from '@/components/OfflineEmpty'
import type { NavId } from '@/layout/Sidebar'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Combobox } from '@/components/ui/combobox'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { Card } from '@/components/ui/card'

const SAMPLE_BODY = `{
  "orderId": "ORD-20250812-08472",
  "userId": 80142,
  "amount": 459.00,
  "items": [
    { "sku": "SKU-A104", "qty": 2 }
  ]
}`

interface HistoryEntry {
  /** Entries are prepended, so an array index would re-key every existing row. */
  id: number
  ok: boolean
  topic: string
  tag: string
  key: string
  delay: number
  time: string
  result?: string
  error?: string
}

const DELAY_LEVELS: number[] = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18]

function formatTime(d: Date): string {
  return d.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
}

export function ProducerPage({ onNavigate }: { onNavigate?: (id: NavId) => void }) {
  const { t } = useTranslation()
  const { topics, hasOnline } = useTopics()
  const { activeKey } = useConnections()
  const { recent: recentTopics, record: recordTopic } = useRecentPicks('topic')

  const [topic, setTopic] = useState<string>('')
  const [tag, setTag] = useState('')
  const [key, setKey] = useState('')
  const [delay, setDelay] = useState(0)
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)
  const [history, setHistory] = useState<HistoryEntry[]>([])
  const [scope, setScope] = useState(() => loadProducerScope(activeKey))
  const nextHistoryId = useRef(0)
  const restoredKeyRef = useRef<string | null>(null)

  const sendableTopics = useMemo(
    () =>
      topics
        .filter((tp) => !tp.topic.startsWith('%RETRY%') && !tp.topic.startsWith('%DLQ%'))
        .map((tp) => tp.topic)
        .sort(),
    [topics],
  )

  // Restore the last topic sent to on this connection, once per connection. Waits for the topic
  // list so a topic that no longer exists on the cluster is never forced into the select.
  // The page unmounts on navigation, so the refill runs again each time it is reopened.
  useEffect(() => {
    if (restoredKeyRef.current === activeKey || sendableTopics.length === 0) return
    restoredKeyRef.current = activeKey
    const restored = loadProducerScope(activeKey)
    setScope(restored)
    if (!restored.lastTopic || !sendableTopics.includes(restored.lastTopic)) {
      // Drop a selection carried over from the previous connection — the select has no
      // matching option for it, so it would silently send to a topic that is not shown.
      setTopic((current) => (sendableTopics.includes(current) ? current : ''))
      return
    }
    setTopic(restored.lastTopic)
    const draft = restored.drafts[restored.lastTopic]
    if (!draft) return
    setTag(draft.tag)
    setKey(draft.key)
    setDelay(draft.delay)
    setBody(draft.body)
  }, [activeKey, sendableTopics])

  const handleTopicChange = (next: string) => {
    setTopic(next)
    const draft = next ? scope.drafts[next] : undefined
    // Leave the form untouched when the topic has nothing saved, so writing the body
    // first and picking the topic afterwards still works.
    if (!draft) return
    setTag(draft.tag)
    setKey(draft.key)
    setDelay(draft.delay)
    setBody(draft.body)
  }

  const handleFormat = () => {
    try {
      const parsed = JSON.parse(body)
      setBody(JSON.stringify(parsed, null, 2))
    } catch {
      toast.error(t('producer.invalidJson'))
    }
  }

  const handleSend = async () => {
    if (!topic) {
      toast.error(t('producer.validateTopic'))
      return
    }
    if (!body.trim()) {
      toast.error(t('producer.validateBody'))
      return
    }
    setBusy(true)
    try {
      const result = await messageApi.sendMessage(topic, tag, key, body, delay)
      const entry: HistoryEntry = {
        id: nextHistoryId.current++,
        ok: true,
        topic,
        tag,
        key,
        delay,
        time: formatTime(new Date()),
        result,
      }
      setHistory((h) => [entry, ...h].slice(0, 50))
      setScope(saveProducerDraft(activeKey, topic, { tag, key, delay, body }))
      recordTopic(topic)
      toast.success(t('producer.sendSuccess'), { description: result })
    } catch (e) {
      const msg = formatErrorMessage(e)
      const entry: HistoryEntry = {
        id: nextHistoryId.current++,
        ok: false,
        topic,
        tag,
        key,
        delay,
        time: formatTime(new Date()),
        error: msg,
      }
      setHistory((h) => [entry, ...h].slice(0, 50))
      toast.error(t('producer.sendError'), { description: msg })
    } finally {
      setBusy(false)
    }
  }

  const handleReset = () => {
    setTag('')
    setKey('')
    setDelay(0)
    setBody('')
    // Also forget the saved content, otherwise leaving and returning would bring it back
    // and the reset would look like it never happened.
    if (topic) setScope(clearProducerDraft(activeKey, topic))
  }

  const subtitle = !hasOnline ? t('producer.subtitleNoConn') : t('producer.subtitle')

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader title={t('producer.title')} subtitle={subtitle} />

      <div className="min-h-0 flex-1 overflow-hidden">
        {!hasOnline ? (
          <OfflineEmpty
            message={t('producer.subtitleNoConn')}
            className="h-full"
            onAction={() => onNavigate?.('connections')}
          />
        ) : (
          <PageBody width="wide">
            <div
              className="grid items-start gap-3.5"
              style={{ gridTemplateColumns: 'minmax(0,1.25fr) minmax(0,1fr)' }}
            >
              {/* Compose */}
              <Card className="flex flex-col gap-3 p-4">
                <div className="flex flex-col gap-1.5">
                  <span className="text-muted-foreground text-fs-11 font-medium">
                    {t('producer.topic')} <span style={{ color: 'hsl(var(--destructive))' }}>*</span>
                  </span>
                  {sendableTopics.length === 0 ? (
                    <div className="text-muted-foreground text-fs-12">{t('producer.noTopics')}</div>
                  ) : (
                    <Combobox
                      className="font-mono-design"
                      value={topic}
                      onChange={handleTopicChange}
                      options={sendableTopics}
                      recent={recentTopics}
                      emptyLabel={t('producer.topicPlaceholder')}
                      searchPlaceholder={t('producer.topicSearchPlaceholder')}
                      recentLabel={t('common.recentUsed')}
                      allLabel={t('common.all')}
                      emptyMessage={t('common.noMatch')}
                      moreHint={(count) => t('common.moreResults', { count })}
                      aria-label={t('producer.topic')}
                    />
                  )}
                  {topic && scope.drafts[topic] && (
                    <span className="text-muted-foreground text-fs-105">
                      {t('producer.draftRestored')}
                    </span>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-2.5">
                  <div className="flex flex-col gap-1.5">
                    <span className="text-muted-foreground text-fs-11 font-medium">
                      {t('producer.tag')}
                    </span>
                    <Input
                      className="font-mono-design"
                      placeholder={t('producer.tagPlaceholder')}
                      value={tag}
                      onChange={(e) => setTag(e.target.value)}
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <span className="text-muted-foreground text-fs-11 font-medium">
                      {t('producer.key')}
                    </span>
                    <Input
                      className="font-mono-design"
                      placeholder={t('producer.keyPlaceholder')}
                      value={key}
                      onChange={(e) => setKey(e.target.value)}
                    />
                  </div>
                </div>

                <div className="flex flex-col gap-1.5">
                  <span className="text-muted-foreground text-fs-11 font-medium">
                    {t('producer.delay')}
                  </span>
                  <Select value={delay} onChange={(e) => setDelay(Number(e.target.value))}>
                    {DELAY_LEVELS.map((lv) => (
                      <option key={lv} value={lv}>
                        {t(`producer.delayLevels.${lv}` as const)}
                      </option>
                    ))}
                  </Select>
                </div>

                <div className="flex flex-col gap-1.5">
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground text-fs-11 font-medium">
                      {t('producer.body')}
                    </span>
                    <span className="flex-1" />
                    <Button variant="ghost" size="sm" onClick={() => setBody(SAMPLE_BODY)}>
                      {t('producer.loadSample')}
                    </Button>
                    <Button variant="ghost" size="sm" onClick={handleFormat} disabled={!body.trim()}>
                      {t('producer.format')}
                    </Button>
                  </div>
                  <Textarea
                    className="min-h-[13.85rem] font-mono-design text-fs-12"
                    placeholder="{ }"
                    value={body}
                    onChange={(e) => setBody(e.target.value)}
                  />
                </div>

                <div className="flex items-center gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleReset}
                    disabled={busy}
                    title={t('producer.resetTitle')}
                  >
                    <RotateCcw size={13} />
                    {t('producer.reset')}
                  </Button>
                  <span className="flex-1" />
                  <Button
                    variant="default"
                    size="sm"
                    onClick={handleSend}
                    disabled={busy || !topic || !body.trim()}
                  >
                    {busy ? <Spinner size={13} /> : <Send size={13} />}
                    {busy ? t('producer.sending') : t('producer.send')}
                  </Button>
                </div>
              </Card>

              {/* History */}
              <Card className="overflow-hidden">
                <div className="flex items-center justify-between border-b border-border px-3 py-2.5">
                  <span className="text-fs-12 font-medium">{t('producer.history')}</span>
                  <span className="text-muted-foreground text-fs-11">
                    {t('producer.historyHint')}
                  </span>
                </div>
                {history.length === 0 ? (
                  <EmptyState compact className="py-9" title={t('producer.historyEmpty')} />
                ) : (
                  history.map((h) => (
                    <div
                      key={h.id}
                      className="flex flex-col gap-1 border-t border-border px-3 py-2.5 first:border-t-0"
                    >
                      <div className="flex items-center gap-2">
                        {h.ok ? (
                          <Check size={11} style={{ color: 'hsl(var(--success))' }} />
                        ) : (
                          <X size={11} style={{ color: 'hsl(var(--destructive))' }} />
                        )}
                        <span className="font-mono-design flex-1 truncate text-fs-12" title={h.topic}>
                          {h.topic}
                        </span>
                        <span className="font-mono-design text-muted-foreground text-fs-11 tabular-nums">
                          {h.time}
                        </span>
                      </div>
                      {h.ok ? (
                        <div
                          className="font-mono-design text-muted-foreground truncate pl-[19px] text-fs-105"
                          title={h.result}
                        >
                          {h.result}
                        </div>
                      ) : (
                        <div
                          className="flex items-start gap-1 pl-[19px] text-fs-11"
                          style={{ color: 'hsl(var(--destructive))' }}
                        >
                          <AlertCircle size={10} className="mt-0.5 shrink-0" />
                          <span className="break-all">{h.error}</span>
                        </div>
                      )}
                      {(h.tag || h.key || h.delay > 0) && (
                        <div className="text-muted-foreground flex flex-wrap gap-2 pl-[19px] text-fs-105">
                          {h.tag && <span>tag: {h.tag}</span>}
                          {h.key && <span>key: {h.key}</span>}
                          {h.delay > 0 && <span>delay: L{h.delay}</span>}
                        </div>
                      )}
                    </div>
                  ))
                )}
              </Card>
            </div>
          </PageBody>
        )}
      </div>
    </div>
  )
}
