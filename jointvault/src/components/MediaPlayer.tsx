import { useCallback, useEffect, useRef, useState } from 'react';
import { convertFileSrc } from '@tauri-apps/api/core';
import { useOpenTarget } from '@/lib/open-target';
import {
  AlertTriangle,
  Check,
  Maximize,
  Minimize,
  MonitorPlay,
  Music,
  Pause,
  PictureInPicture2,
  Play,
  RotateCcw,
  RotateCw,
  Volume1,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Menu,
  MenuContent,
  MenuItem,
  MenuTrigger,
} from '@/components/ui/menu';

const AUDIO_EXTS = new Set(['mp3', 'm4a', 'aac', 'wav', 'flac', 'ogg', 'wma', 'opus']);

export function isAudioMedia(pathOrUrl: string): boolean {
  const clean = pathOrUrl.split('?')[0].split('#')[0];
  const ext = clean.split('.').pop()?.toLowerCase() ?? '';
  return AUDIO_EXTS.has(ext);
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  if (hrs > 0) {
    return `${hrs}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

const PLAYBACK_RATES = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2] as const;

export interface MediaPlayerProps {
  src: string; // Yerel dosya yolu (Tauri convertFileSrc ile dönüştürülür)
  title?: string;
  poster?: string | null;
  isAudio?: boolean;
  autoPlay?: boolean;
  embedded?: boolean;
  paused?: boolean;
  initialTime?: number;
  onTimeProgress?: (time: number) => void;
  onExpand?: (currentTime: number) => void;
  className?: string;
}

export function MediaPlayer({
  src,
  title,
  poster,
  isAudio: forceAudio,
  autoPlay = false,
  embedded = false,
  paused = false,
  initialTime = 0,
  onTimeProgress,
  onExpand,
  className = '',
}: MediaPlayerProps) {
  const { open } = useOpenTarget();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const timelineRef = useRef<HTMLDivElement | null>(null);

  const isAudio = forceAudio !== undefined ? forceAudio : isAudioMedia(src);

  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [buffered, setBuffered] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [playbackRate, setPlaybackRate] = useState<number>(1);
  const [fullscreen, setFullscreen] = useState(false);
  const [pipAvailable, setPipAvailable] = useState(false);
  const [pipActive, setPipActive] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [hoverTime, setHoverTime] = useState<number | null>(null);
  const [hoverX, setHoverX] = useState<number>(0);
  const [mediaError, setMediaError] = useState<string | null>(null);

  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Güvenli dosya URL'si: dosya adındaki '#' ve '?' gibi URL kırıcı karakterleri kodla
  const safeSrc = src.replace(/#/g, '%23').replace(/\?/g, '%3F');
  const fileUrl = convertFileSrc(safeSrc);

  // Dışarıdan durdurma kontrolü (örn. sinema moduna geçildiğinde gömülü oynatıcıyı sustur)
  useEffect(() => {
    if (paused && videoRef.current && !videoRef.current.paused) {
      videoRef.current.pause();
      setPlaying(false);
    }
  }, [paused]);

  // Başlangıç zamanı desteği (örn. kayıttan sinema moduna geçişte kalınan saniyeden devam et)
  useEffect(() => {
    if (initialTime > 0 && videoRef.current) {
      videoRef.current.currentTime = initialTime;
      setCurrentTime(initialTime);
    }
  }, [initialTime]);

  // Picture-in-Picture desteği
  useEffect(() => {
    if (typeof document !== 'undefined' && 'pictureInPictureEnabled' in document) {
      setPipAvailable(Boolean(document.pictureInPictureEnabled) && !isAudio);
    }
  }, [isAudio]);

  // Otomatik gizlenme zamanlayıcısı (fare hareketsizken 4 saniye sonra gizle, gömülü modda gizleme)
  const resetHideTimer = useCallback(() => {
    setControlsVisible(true);
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    if (playing && !embedded) {
      hideTimerRef.current = setTimeout(() => {
        setControlsVisible(false);
      }, 4000);
    }
  }, [playing, embedded]);

  useEffect(() => {
    if (!playing) {
      setControlsVisible(true);
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    } else {
      resetHideTimer();
    }
    return () => {
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    };
  }, [playing, resetHideTimer]);

  // Tam ekran dinleyicisi
  useEffect(() => {
    const onFsChange = () => {
      setFullscreen(Boolean(document.fullscreenElement));
    };
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);

  // Temel oynatma kontrolleri
  const togglePlay = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused || v.ended) {
      void v.play();
    } else {
      v.pause();
    }
  }, []);

  const seekRelative = useCallback((delta: number) => {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = Math.max(0, Math.min(v.duration || 0, v.currentTime + delta));
    resetHideTimer();
  }, [resetHideTimer]);

  const toggleMute = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    v.muted = !v.muted;
    setMuted(v.muted);
    resetHideTimer();
  }, [resetHideTimer]);

  const handleVolumeChange = useCallback((newVol: number) => {
    const v = videoRef.current;
    if (!v) return;
    const clamped = Math.max(0, Math.min(1, newVol));
    v.volume = clamped;
    v.muted = clamped === 0;
    setVolume(clamped);
    setMuted(v.muted);
    resetHideTimer();
  }, [resetHideTimer]);

  const changePlaybackRate = useCallback((rate: number) => {
    const v = videoRef.current;
    if (!v) return;
    v.playbackRate = rate;
    setPlaybackRate(rate);
    resetHideTimer();
  }, [resetHideTimer]);

  const toggleFullscreen = useCallback(async () => {
    if (!containerRef.current) return;
    try {
      if (!document.fullscreenElement) {
        await containerRef.current.requestFullscreen();
      } else {
        await document.exitFullscreen();
      }
    } catch (e) {
      console.error('Fullscreen toggle error:', e);
    }
  }, []);

  const togglePip = useCallback(async () => {
    const v = videoRef.current;
    if (!v || !pipAvailable) return;
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
        setPipActive(false);
      } else {
        await v.requestPictureInPicture();
        setPipActive(true);
      }
    } catch (e) {
      console.error('PiP toggle error:', e);
    }
  }, [pipAvailable]);

  // Zaman çubuğu etkileşimi
  const handleTimelineMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!timelineRef.current || duration <= 0) return;
    const rect = timelineRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(rect.width, e.clientX - rect.width - rect.left + rect.width));
    const pct = x / rect.width;
    setHoverTime(pct * duration);
    setHoverX(x);
  };

  const handleTimelineLeave = () => {
    setHoverTime(null);
  };

  const handleTimelineClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!timelineRef.current || duration <= 0) return;
    const rect = timelineRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
    const pct = x / rect.width;
    const nextTime = pct * duration;
    if (videoRef.current) {
      videoRef.current.currentTime = nextTime;
      setCurrentTime(nextTime);
    }
    resetHideTimer();
  };

  // Klavye kısayolları
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // Eğer kullanıcı bir input/textarea içinde yazıyorsa kısayolları yutma
      const target = e.target as HTMLElement;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
        return;
      }

      if (e.code === 'Space' || e.code === 'KeyK') {
        e.preventDefault();
        togglePlay();
      } else if (e.code === 'ArrowLeft' || e.code === 'KeyJ') {
        e.preventDefault();
        seekRelative(-5);
      } else if (e.code === 'ArrowRight' || e.code === 'KeyL') {
        e.preventDefault();
        seekRelative(5);
      } else if (e.code === 'ArrowUp') {
        e.preventDefault();
        handleVolumeChange(volume + 0.1);
      } else if (e.code === 'ArrowDown') {
        e.preventDefault();
        handleVolumeChange(volume - 0.1);
      } else if (e.code === 'KeyM') {
        e.preventDefault();
        toggleMute();
      } else if (e.code === 'KeyF' && !embedded) {
        e.preventDefault();
        void toggleFullscreen();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [togglePlay, seekRelative, handleVolumeChange, toggleMute, toggleFullscreen, volume, embedded]);

  // Video element olayları
  const handleTimeUpdate = () => {
    if (videoRef.current) {
      const cur = videoRef.current.currentTime;
      setCurrentTime(cur);
      onTimeProgress?.(cur);
      if (videoRef.current.buffered.length > 0) {
        setBuffered(videoRef.current.buffered.end(videoRef.current.buffered.length - 1));
      }
    }
  };

  const progressPct = duration > 0 ? (currentTime / duration) * 100 : 0;
  const bufferedPct = duration > 0 ? (buffered / duration) * 100 : 0;

  return (
    <div
      ref={containerRef}
      onMouseMove={resetHideTimer}
      onMouseEnter={resetHideTimer}
      className={`group/player relative flex flex-col items-center justify-center overflow-hidden bg-black select-none ${
        fullscreen ? 'fixed inset-0 z-[9999] size-full w-screen h-screen rounded-none' : 'w-full rounded-lg'
      } ${className}`}
      style={{ aspectRatio: isAudio && !fullscreen ? '16 / 9' : undefined }}
    >
      {/* Medya Öğesi (HTML5 video veya audio) */}
      <video
        ref={videoRef}
        src={fileUrl}
        poster={poster ?? undefined}
        autoPlay={autoPlay}
        playsInline
        preload="metadata"
        onClick={togglePlay}
        onPlay={() => {
          setPlaying(true);
          setMediaError(null);
        }}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onTimeUpdate={handleTimeUpdate}
        onError={(e) => {
          console.warn('[MediaPlayer] Video yükleme hatası:', e);
          setMediaError('Bu video doğrudan oynatılamadı veya format desteklenmiyor.');
        }}
        onLoadedMetadata={() => {
          if (videoRef.current) {
            if (initialTime > 0) {
              videoRef.current.currentTime = initialTime;
              setCurrentTime(initialTime);
            }
            setDuration(videoRef.current.duration);
            setVolume(videoRef.current.volume);
            setMuted(videoRef.current.muted);
          }
        }}
        className={`size-full object-contain ${isAudio ? 'hidden' : 'block cursor-pointer'}`}
      />

      {/* Hata Durumu Bildirimi */}
      {mediaError && (
        <div className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-3 bg-neutral-950/90 p-4 text-center text-white backdrop-blur-md">
          <AlertTriangle className="size-8 text-amber-500" />
          <div className="flex flex-col gap-1 max-w-sm">
            <p className="text-sm font-semibold">{mediaError}</p>
            <p className="text-2xs text-white/70">
              Bu video tarayıcı motorunda çözümlenemedi. Harici sistem oynatıcınızda (VLC vb.) açabilirsiniz.
            </p>
          </div>
          <div className="flex items-center gap-2 mt-1">
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5 text-xs border-white/20 text-white hover:bg-white/10"
              onClick={() => open(src)}
            >
              <MonitorPlay className="size-3.5" /> Sistem Oynatıcısında Aç
            </Button>
            {onExpand && (
              <Button
                size="sm"
                variant="stamp"
                className="gap-1.5 text-xs"
                onClick={() => onExpand(currentTime)}
              >
                <Maximize className="size-3.5" /> Sinema Modu
              </Button>
            )}
          </div>
        </div>
      )}

      {/* Ses Modu Görselleştiricisi */}
      {isAudio && (
        <div
          onClick={togglePlay}
          className="relative flex size-full cursor-pointer flex-col items-center justify-center gap-4 bg-gradient-to-b from-neutral-900 via-neutral-950 to-black p-6 text-center"
        >
          {poster ? (
            <div className="relative size-28 overflow-hidden rounded-xl border border-white/10 shadow-lift transition-transform duration-300 group-hover/player:scale-105 sm:size-36">
              <img src={poster} alt="" className="size-full object-cover" />
              {playing && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/40 backdrop-blur-xs">
                  <div className="flex items-end gap-1">
                    <span className="h-6 w-1 animate-[bounce_0.8s_infinite] rounded-full bg-primary" />
                    <span className="h-10 w-1 animate-[bounce_0.6s_infinite_0.1s] rounded-full bg-primary" />
                    <span className="h-8 w-1 animate-[bounce_0.7s_infinite_0.2s] rounded-full bg-primary" />
                    <span className="h-4 w-1 animate-[bounce_0.5s_infinite_0.3s] rounded-full bg-primary" />
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="flex size-24 items-center justify-center rounded-2xl border border-white/10 bg-primary/10 text-primary shadow-xl sm:size-32">
              <Music className="size-12 animate-pulse" />
            </div>
          )}

          <div className="flex max-w-md flex-col gap-1">
            <h4 className="line-clamp-1 text-sm font-semibold text-white sm:text-base">
              {title || 'Ses Dosyası'}
            </h4>
            <span className="font-mono text-2xs tracking-wider text-muted-foreground uppercase">
              {isAudio ? 'Ses Kaydı' : 'Video'} · {formatTime(currentTime)} / {formatTime(duration)}
            </span>
          </div>
        </div>
      )}

      {/* Büyük Orta Oynat/Duraklat Rozeti (Tıklama Geri Bildirimi) */}
      {!playing && !isAudio && (
        <button
          type="button"
          onClick={togglePlay}
          className="absolute z-10 flex size-14 items-center justify-center rounded-full bg-black/60 text-white backdrop-blur-md transition-transform duration-200 hover:scale-110 active:scale-95 sm:size-16"
          aria-label="Oynat"
        >
          <Play className="ml-1 size-7 fill-white text-white sm:size-8" />
        </button>
      )}

      {/* Kontroller Katmanı (Overlay) */}
      <div
        onMouseEnter={() => {
          if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
          setControlsVisible(true);
        }}
        onMouseLeave={resetHideTimer}
        className={`absolute inset-x-0 bottom-0 z-20 flex flex-col justify-end bg-gradient-to-t from-black/90 via-black/40 to-transparent ${
          embedded ? 'p-2 pt-6' : 'p-3 pt-8 sm:p-4'
        } transition-opacity duration-300 ${
          controlsVisible || !playing || embedded ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
      >
        {/* Zaman Çubuğu (Scrubber Timeline) */}
        <div
          ref={timelineRef}
          onClick={handleTimelineClick}
          onMouseMove={handleTimelineMove}
          onMouseLeave={handleTimelineLeave}
          className="group/timeline relative mb-2 flex h-3 w-full cursor-pointer items-center"
        >
          {/* Arka plan rayı */}
          <div className="h-1 w-full rounded-full bg-white/20 transition-all group-hover/timeline:h-2">
            {/* Arabelleğe alınan (Buffer) */}
            <div
              className="h-full rounded-full bg-white/30 transition-all"
              style={{ width: `${bufferedPct}%` }}
            />
            {/* Oynatılan ilerleme */}
            <div
              className="absolute top-0 bottom-0 left-0 rounded-full bg-primary transition-all group-hover/timeline:h-2"
              style={{ width: `${progressPct}%` }}
            />
          </div>

          {/* Oynat Kafası (Thumb) */}
          <div
            className="absolute size-3 -translate-x-1/2 rounded-full bg-white shadow-md transition-transform duration-100 group-hover/timeline:scale-125"
            style={{ left: `${progressPct}%` }}
          />

          {/* Hover Zaman Baloncuğu */}
          {hoverTime !== null && (
            <div
              className="pointer-events-none absolute -top-8 -translate-x-1/2 rounded bg-black/90 px-1.5 py-0.5 font-mono text-3xs text-white shadow-md backdrop-blur-xs"
              style={{ left: `${hoverX}px` }}
            >
              {formatTime(hoverTime)}
            </div>
          )}
        </div>

        {/* Alt Butonlar ve Kontrol Çubuğu */}
        <div className="flex items-center justify-between gap-1 sm:gap-2 text-white min-w-0">
          {/* Sol Kısım: Oynat, Sarma, Ses, Süre */}
          <div className="flex items-center gap-1 sm:gap-1.5 min-w-0 shrink">
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={togglePlay}
              className="text-white hover:bg-white/20 hover:text-white shrink-0"
              aria-label={playing ? 'Duraklat (Boşluk)' : 'Oynat (Boşluk)'}
            >
              {playing ? <Pause className="size-4 fill-white" /> : <Play className="size-4 fill-white" />}
            </Button>

            {!embedded && (
              <>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => seekRelative(-5)}
                  className="hidden text-white hover:bg-white/20 hover:text-white sm:inline-flex shrink-0"
                  title="5 saniye geri (Sol Ok)"
                  aria-label="5 saniye geri"
                >
                  <RotateCcw className="size-3.5" />
                </Button>

                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => seekRelative(5)}
                  className="hidden text-white hover:bg-white/20 hover:text-white sm:inline-flex shrink-0"
                  title="5 saniye ileri (Sağ Ok)"
                  aria-label="5 saniye ileri"
                >
                  <RotateCw className="size-3.5" />
                </Button>
              </>
            )}

            {/* Ses Kontrolü */}
            <div className="group/vol flex items-center gap-0.5 sm:gap-1 shrink-0">
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={toggleMute}
                className="text-white hover:bg-white/20 hover:text-white shrink-0"
                title={muted ? 'Sesi Aç (M)' : 'Sessize Al (M)'}
                aria-label="Ses kontrolü"
              >
                {muted || volume === 0 ? (
                  <VolumeX className="size-4 text-destructive" />
                ) : volume < 0.5 ? (
                  <Volume1 className="size-4" />
                ) : (
                  <Volume2 className="size-4" />
                )}
              </Button>

              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={muted ? 0 : volume}
                onChange={(e) => handleVolumeChange(Number.parseFloat(e.target.value))}
                className="h-1 w-0 cursor-pointer accent-primary opacity-0 transition-all duration-200 group-hover/vol:w-14 group-hover/vol:opacity-100 sm:group-hover/vol:w-18"
                aria-label="Ses seviyesi"
              />
            </div>

            {/* Zaman Metni */}
            <span className="font-mono text-2xs tabular-nums text-white/80 shrink-0 select-none">
              {formatTime(currentTime)} <span className="text-white/40">/</span> {formatTime(duration)}
            </span>
          </div>

          {/* Sağ Kısım: Hız, PiP, Büyüt / Tam Ekran */}
          <div className="flex items-center gap-0.5 sm:gap-1 shrink-0 ml-auto">
            {/* Oynatma Hızı Menüsü */}
            <Menu>
              <MenuTrigger
                render={
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-1.5 font-mono text-2xs font-semibold text-white hover:bg-white/20 hover:text-white shrink-0"
                    title="Oynatma Hızı"
                  />
                }
              >
                {playbackRate}x
              </MenuTrigger>
              <MenuContent align="end" className="min-w-28 border-white/10 bg-neutral-900 text-white">
                <div className="px-2 py-1 text-3xs font-semibold text-muted-foreground uppercase">
                  Oynatma Hızı
                </div>
                {PLAYBACK_RATES.map((rate) => (
                  <MenuItem
                    key={rate}
                    onClick={() => changePlaybackRate(rate)}
                    className="flex items-center justify-between text-xs hover:bg-white/10"
                  >
                    <span>{rate}x</span>
                    {playbackRate === rate && <Check className="size-3.5 text-primary" />}
                  </MenuItem>
                ))}
              </MenuContent>
            </Menu>

            {/* PiP Butonu (Varsa) */}
            {pipAvailable && !isAudio && !embedded && (
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => void togglePip()}
                className={`text-white hover:bg-white/20 hover:text-white shrink-0 ${
                  pipActive ? 'text-primary' : ''
                }`}
                title="Resim içinde Resim (PiP)"
                aria-label="Resim içinde Resim"
              >
                <PictureInPicture2 className="size-3.5" />
              </Button>
            )}

            {/* Gömülü moddaysa Genişlet butonu */}
            {embedded && onExpand && (
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => onExpand(currentTime)}
                className="text-white hover:bg-white/20 hover:text-white shrink-0"
                title="Sinema Modunda Aç"
                aria-label="Sinema Modunda Aç"
              >
                <Maximize className="size-3.5" />
              </Button>
            )}

            {/* Tam Ekran Butonu (Sinema modunda) */}
            {!embedded && (
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => void toggleFullscreen()}
                className="text-white hover:bg-white/20 hover:text-white shrink-0"
                title={fullscreen ? 'Tam Ekrandan Çık (F)' : 'Tam Ekran (F)'}
                aria-label="Tam Ekran"
              >
                {fullscreen ? <Minimize className="size-4" /> : <Maximize className="size-4" />}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
