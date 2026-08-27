import { useState, useCallback, useEffect, useRef } from 'react'
import {
  Check,
  ChevronDown,
  Minus,
  Plus,
  Settings2,
  Square,
  SquareMinus,
  Unlink,
  X,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { cn, formatErrorMessage } from '@/lib/utils'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { Spinner } from '@/components/Spinner'
import { useConnections } from '@/hooks/useConnections'
import { useSettings } from '@/hooks/useSettings'
import * as connectionApi from '@/api/connection'
import { isMac, windowControls } from '@/api/platform'
import logoUrl from '@/assets/logo.png'
import type { Connection } from '@/api/models'

export function TitleBar({
  connected = null,
  onOpenConnections,
}: {
  connected?: string | null
  onOpenConnections?: () => void
}) {
  const { t } = useTranslation()
  const mac = isMac()
  const { list, refresh } = useConnections()
  const { settings } = useSettings()
  const [isMaximised, setIsMaximised] = useState(false)
  const [showCloseConfirm, setShowCloseConfirm] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [busyId, setBusyId] = useState<number | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  const online = Boolean(connected)
  const active = list.find((c) => c.status === 'online') ?? null

  const refreshMaximised = useCallback(async () => {
    try {
      const max = await windowControls.isMaximised()
      setIsMaximised(max)
    } catch {
      setIsMaximised(false)
    }
  }, [])

  useEffect(() => {
    void refreshMaximised()
    return windowControls.onMaximisedChange(setIsMaximised)
  }, [refreshMaximised])

  // Close dropdown on outside click / Escape
  useEffect(() => {
    if (!menuOpen) return
    const onDoc = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [menuOpen])

  const handleMinimise = useCallback(() => {
    windowControls.minimise().catch(() => {})
  }, [])
  const handleToggleMaximise = useCallback(() => {
    // Linux emits no maximise event, so re-read the state after toggling.
    windowControls.toggleMaximise().then(refreshMaximised).catch(refreshMaximised)
  }, [refreshMaximised])
  // Go decides what closing means. Minimising to the tray is reversible, so it
  // needs no confirmation; quitting still asks.
  const handleClose = useCallback(() => {
    if (settings.closeBehavior === 'minimizeToTray') {
      windowControls.close().catch(() => {})
      return
    }
    setShowCloseConfirm(true)
  }, [settings.closeBehavior])

  const switchTo = async (conn: Connection) => {
    if (conn.status === 'online') {
      setMenuOpen(false)
      return
    }
    setBusyId(conn.id)
    try {
      // Disconnect any currently online profiles first
      for (const c of list) {
        if (c.status === 'online' && c.id !== conn.id) {
          await connectionApi.disconnect(c.id)
        }
      }
      await connectionApi.connect(conn.id)
      toast.success(t('connections.connectSuccess', { name: conn.name }), {
        id: 'titlebar-conn',
      })
      setMenuOpen(false)
    } catch (e) {
      toast.error(formatErrorMessage(e), { id: 'titlebar-conn' })
    } finally {
      // After disconnecting the previous connection, always sync real state even if the new connect fails.
      await refresh().catch(() => undefined)
      setBusyId(null)
    }
  }

  const handleDisconnectActive = async () => {
    if (!active) return
    setBusyId(active.id)
    try {
      await connectionApi.disconnect(active.id)
      toast.success(t('connections.disconnectSuccess', { name: active.name }), {
        id: 'titlebar-conn',
      })
      await refresh()
      setMenuOpen(false)
    } catch (e) {
      toast.error(formatErrorMessage(e), { id: 'titlebar-conn' })
    } finally {
      setBusyId(null)
    }
  }

  const winBtnClass =
    'app-region-no-drag flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground'
  const closeBtnClass =
    'app-region-no-drag flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-destructive/15 hover:text-destructive'

  return (
    <>
      <header className={cn('mqs-title-bar app-region-drag', !mac && 'mqs-title-bar--win')}>
        <img src={logoUrl} alt="" className="logo-img" aria-hidden />
        <div className="title">{t('app.name')}</div>
        <div className="flex-1" />

        <div className="conn-menu-wrap app-region-no-drag" ref={menuRef}>
          <button
            type="button"
            className={cn('conn-pill', online ? 'online' : 'offline', menuOpen && 'open')}
            onClick={() => setMenuOpen((v) => !v)}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            title={
              online ? t('titlebar.connectedHint', { name: connected }) : t('titlebar.offlineHint')
            }
          >
            <span className="dot" aria-hidden />
            <span className="conn-status">
              {online ? t('common.connected') : t('common.offline')}
            </span>
            <span className="conn-sep" aria-hidden />
            <span className="conn-name">{online ? connected : t('titlebar.noCluster')}</span>
            <ChevronDown size={12} className={cn('conn-chevron', menuOpen && 'open')} aria-hidden />
          </button>

          {menuOpen && (
            <div className="conn-menu" role="menu">
              <div className="conn-menu-label">{t('titlebar.switchConnection')}</div>
              {list.length === 0 ? (
                <div className="conn-menu-empty">{t('titlebar.noConnections')}</div>
              ) : (
                list.map((c) => {
                  const isOnline = c.status === 'online'
                  const busy = busyId === c.id
                  return (
                    <button
                      key={c.id}
                      type="button"
                      role="menuitem"
                      className={cn('conn-menu-item', isOnline && 'active')}
                      disabled={busyId != null}
                      onClick={() => void switchTo(c)}
                    >
                      <span className={cn('item-dot', isOnline ? 'on' : 'off')} aria-hidden />
                      <span className="item-body">
                        <span className="item-name">
                          {c.name}
                          {c.isDefault && (
                            <span className="item-default">{t('connections.default')}</span>
                          )}
                        </span>
                        <span className="item-addr font-mono-design">
                          {(c.endpoints || '').split(/[;\s,]+/)[0] || '—'}
                        </span>
                      </span>
                      {busy ? (
                        <Spinner size={12} />
                      ) : isOnline ? (
                        <Check size={13} className="item-check" />
                      ) : null}
                    </button>
                  )
                })
              )}

              <div className="conn-menu-sep" />

              {active && (
                <button
                  type="button"
                  role="menuitem"
                  className="conn-menu-item danger"
                  disabled={busyId != null}
                  onClick={() => void handleDisconnectActive()}
                >
                  {busyId === active.id ? <Spinner size={12} /> : <Unlink size={13} />}
                  <span>{t('connections.disconnect')}</span>
                </button>
              )}

              <button
                type="button"
                role="menuitem"
                className="conn-menu-item"
                onClick={() => {
                  setMenuOpen(false)
                  onOpenConnections?.()
                }}
              >
                {list.length === 0 ? <Plus size={13} /> : <Settings2 size={13} />}
                <span>
                  {list.length === 0 ? t('connections.addFirst') : t('titlebar.manageConnections')}
                </span>
              </button>
            </div>
          )}
        </div>

        {!mac && (
          <div className="app-region-no-drag flex shrink-0 items-center gap-0.5">
            <button
              type="button"
              onClick={handleMinimise}
              className={winBtnClass}
              title={t('common.minimize')}
              aria-label={t('common.minimize')}
            >
              <Minus className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={handleToggleMaximise}
              className={winBtnClass}
              title={isMaximised ? t('common.restore') : t('common.maximize')}
              aria-label={isMaximised ? t('common.restore') : t('common.maximize')}
            >
              {isMaximised ? <SquareMinus className="h-4 w-4" /> : <Square className="h-4 w-4" />}
            </button>
            <button
              type="button"
              onClick={handleClose}
              className={closeBtnClass}
              title={t('common.close')}
              aria-label={t('common.close')}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )}
      </header>

      <ConfirmDialog
        open={showCloseConfirm}
        title={t('common.exitApp')}
        description={t('common.exitAppConfirm')}
        confirmText={t('common.exit')}
        cancelText={t('common.cancel')}
        variant="destructive"
        onConfirm={() => windowControls.close().catch(() => {})}
        onCancel={() => setShowCloseConfirm(false)}
      />
    </>
  )
}
