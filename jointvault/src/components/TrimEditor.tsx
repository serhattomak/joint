import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import { Loader2, Pause, Play, Repeat, StepBack, StepForward } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

// Rust MediaProbeResult: duration_secs + thumbs + wave are plain OS paths,
// jobId is serde-renamed — frontend maps every path via convertFileSrc.
interface MediaProbeResult {
  duration_secs: number;
  thumbs: string[];
  wave: string;
  jobId: string;
}

const FRAME = 1 / 30; // yaklaşıklık: <video> gerçek fps vermez

function fmtClock(t: number): string {
  if (!Number.isFinite(t) || t < 0) return '0:00.0';
  return `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, '0')}`;
}

interface TrimEditorProps {
  inputPath: string;
  from: number;
  to: number;
  onFromChange: (n: number) => void;
  onToChange: (n: number) => void;
  disabled?: boolean;
}

// Editör timeline'ı: önizleme + sürüklenebilir oynat kafası/in-out +
// zoom + kare adım + kısayollar + döngü + film şeridi + dalga. Davinci
// değil, ama sayısal girdi hiç değil.
export function TrimEditor({ inputPath, from, to, onFromChange, onToChange, disabled }: TrimEditorProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const rulerRef = useRef<HTMLDivElement | null>(null);
  const dragMode = useRef<'scrub' | 'in' | 'out' | null>(null);
  const [probing, setProbing] = useState(false);
  const [probeError, setProbeError] = useState<string | null>(null);
  const [duration, setDuration] = useState(0);
  const [thumbs, setThumbs] = useState<string[]>([]);
  const [wave, setWave] = useState('');
  const [currentTime, setCurrentTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [zoomSec, setZoomSec] = useState<number | null>(null);
  const [viewStart, setViewStart] = useState(0);
  const [loop, setLoop] = useState(true);

  const hasDuration = Number.isFinite(duration) && duration > 0;
  const clampT = (n: number): number => (hasDuration ? Math.max(0, Math.min(duration, n)) : 0);

  useEffect(() => {
    let cancelled = false;
    let probeJobId: string | null = null;
    setProbing(true);
    setProbeError(null);
    setDuration(0);
    setThumbs([]);
    setWave('');
    setCurrentTime(0);
    setPlaying(false);
    setZoomSec(null);
    setViewStart(0);
    onFromChange(0);
    onToChange(0);
    void invoke<MediaProbeResult>('media_probe', { payload: { input_path: inputPath } })
      .then((res) => {
        if (cancelled) {
          // ponytail: best-effort temp cleanup — errors ignored by design.
          void invoke('media_probe_cleanup', { payload: { jobId: res.jobId } }).catch(() => {});
          return;
        }
        probeJobId = res.jobId;
        setDuration(res.duration_secs);
        setThumbs(res.thumbs);
        setWave(res.wave);
        onFromChange(0);
        onToChange(res.duration_secs);
        setProbing(false);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        const message = typeof e === 'string' ? e : e instanceof Error ? e.message : 'Önizleme üretilemedi.';
        setProbeError(message);
        setProbing(false);
      });
    return () => {
      cancelled = true;
      if (probeJobId) void invoke('media_probe_cleanup', { payload: { jobId: probeJobId } }).catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inputPath]);

  const seekTo = (t: number): void => {
    const v = videoRef.current;
    if (!v || !hasDuration) return;
    v.currentTime = clampT(t);
    setCurrentTime(clampT(t));
  };

  const stepFrame = (dir: 1 | -1, big: boolean): void => {
    seekTo((videoRef.current?.currentTime ?? currentTime) + dir * (big ? 1 : FRAME));
  };

  // Oynat kafası takibi + döngü + pencereyi izleme.
  useEffect(() => {
    let raf = 0;
    const tick = (): void => {
      const v = videoRef.current;
      if (v) {
        const t = v.currentTime;
        setCurrentTime((prev) => (Math.abs(prev - t) > 0.001 ? t : prev));
        if (loop && !v.paused && hasDuration && to > from && t >= to - 0.03) {
          v.currentTime = from;
        }
        if (!v.paused && zoomSec !== null && hasDuration) {
          const len = Math.min(zoomSec, duration);
          setViewStart((s) => {
            const cs = Math.max(0, Math.min(duration - len, s));
            if (t < cs || t > cs + len) return Math.max(0, Math.min(duration - len, t - len * 0.2));
            return s === cs ? s : cs;
          });
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [loop, from, to, duration, zoomSec, hasDuration]);

  // Klavye: Boşluk oynat, oklar kare, I/O işaret, Home/End.
  useEffect(() => {
    if (disabled) return;
    const onKey = (e: KeyboardEvent): void => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
      const v = videoRef.current;
      if (e.code === 'Space') {
        e.preventDefault();
        if (!v) return;
        if (v.paused) void v.play();
        else v.pause();
      } else if (e.code === 'ArrowLeft') {
        if (v) v.currentTime = clampT(v.currentTime - (e.shiftKey ? 1 : FRAME));
      } else if (e.code === 'ArrowRight') {
        if (v) v.currentTime = clampT(v.currentTime + (e.shiftKey ? 1 : FRAME));
      } else if (e.code === 'KeyI') {
        if (v) onFromChange(Math.min(clampT(v.currentTime), to - 0.1));
      } else if (e.code === 'KeyO') {
        if (v) onToChange(Math.max(clampT(v.currentTime), from + 0.1));
      } else if (e.code === 'Home') {
        seekTo(0);
      } else if (e.code === 'End') {
        seekTo(duration);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [disabled, duration, from, to, hasDuration]);

  // Görünür pencere: zoom yoksa tamamı.
  const winLen = !hasDuration || zoomSec === null ? duration : Math.min(zoomSec, duration);
  const winStart = Math.max(0, Math.min(Math.max(0, duration - winLen), viewStart));
  const tToPct = (t: number): number => (winLen > 0 ? ((t - winStart) / winLen) * 100 : 0);

  const timeAt = (clientX: number): number | null => {
    const el = rulerRef.current;
    if (!el || !hasDuration || winLen <= 0) return null;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0) return null;
    return winStart + ((clientX - rect.left) / rect.width) * winLen;
  };

  const applyDrag = (t: number): void => {
    const c = clampT(t);
    const mode = dragMode.current;
    if (mode === 'in') onFromChange(Math.min(c, to - 0.1));
    else if (mode === 'out') onToChange(Math.max(c, from + 0.1));
    else seekTo(c);
  };

  const onRulerDown = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (!hasDuration || disabled) return;
    const t = timeAt(e.clientX);
    if (t === null) return;
    const rect = rulerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = e.clientX - rect.left;
    const inX = ((from - winStart) / winLen) * rect.width;
    const outX = ((to - winStart) / winLen) * rect.width;
    dragMode.current = Math.abs(x - inX) < 12 ? 'in' : Math.abs(x - outX) < 12 ? 'out' : 'scrub';
    applyDrag(t);
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onRulerMove = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (!dragMode.current || !(e.buttons & 1)) return;
    const t = timeAt(e.clientX);
    if (t !== null) applyDrag(t);
  };

  const endDrag = (): void => {
    dragMode.current = null;
  };

  const ticks = hasDuration && winLen > 0 ? Array.from({ length: 6 }, (_, i) => winStart + (winLen * i) / 5) : [];
  const visibleThumbs = thumbs.filter((_, i) => {
    const t = thumbs.length > 0 ? (duration * (i + 0.5)) / thumbs.length : 0;
    return t >= winStart && t <= winStart + winLen;
  });
  const regionLeft = tToPct(from);
  const regionWidth = Math.max(0, tToPct(to) - regionLeft);
  const playPct = Math.max(0, Math.min(100, tToPct(currentTime)));
  const zoomMin = hasDuration ? Math.min(5, duration) : 5;

  if (probing) {
    return (
      <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground" role="status">
        <Loader2 className="size-4 animate-spin" /> Önizleme hazırlanıyor…
      </div>
    );
  }

  if (probeError) {
    return (
      <div className="flex flex-col gap-1 py-4">
        <p className="text-sm text-destructive">Önizleme başarısız: {probeError}</p>
        <p className="text-xs text-muted-foreground">Önizleme için varsayılan indirme klasörünü kullanın.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <video
        ref={videoRef}
        controls
        preload="metadata"
        src={convertFileSrc(inputPath)}
        className="max-h-64 w-full rounded-lg bg-black"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
      />
      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => {
            const v = videoRef.current;
            if (!v) return;
            if (v.paused) void v.play();
            else v.pause();
          }}
          aria-label={playing ? 'Duraklat (Boşluk)' : 'Oynat (Boşluk)'}
        >
          {playing ? <Pause /> : <Play />}
        </Button>
        <Button variant="ghost" size="icon-sm" onClick={() => stepFrame(-1, false)} aria-label="Bir kare geri (←)">
          <StepBack />
        </Button>
        <Button variant="ghost" size="icon-sm" onClick={() => stepFrame(1, false)} aria-label="Bir kare ileri (→)">
          <StepForward />
        </Button>
        <Button
          variant={loop ? 'default' : 'ghost'}
          size="icon-sm"
          onClick={() => setLoop((l) => !l)}
          aria-label="Aralığı döngüyle oynat"
          aria-pressed={loop}
        >
          <Repeat />
        </Button>
        <span className="ml-1 text-xs tabular-nums text-muted-foreground">
          {fmtClock(currentTime)} / {fmtClock(duration)}
        </span>
        <span className="ml-auto text-xs tabular-nums text-muted-foreground">
          Seçim: {fmtClock(from)} → {fmtClock(to)}
        </span>
      </div>
      <div>
        <div className="flex h-4 items-end justify-between text-[10px] tabular-nums text-muted-foreground">
          {ticks.map((t) => (
            <span key={t}>{fmtClock(t)}</span>
          ))}
        </div>
        <div
          ref={rulerRef}
          onPointerDown={onRulerDown}
          onPointerMove={onRulerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          className="relative h-12 cursor-crosshair touch-none rounded bg-muted select-none"
          aria-label="Zaman çizelgesi — sürükleyerek konum ve aralık seç"
        >
          <div
            className="absolute inset-y-0 rounded bg-primary/30"
            style={{ left: `${regionLeft}%`, width: `${regionWidth}%` }}
          />
          <div
            className="absolute inset-y-0 w-2.5 cursor-ew-resize rounded-l bg-primary"
            style={{ left: `calc(${regionLeft}% - 5px)` }}
            title="Giriş noktası (I)"
          />
          <div
            className="absolute inset-y-0 w-2.5 cursor-ew-resize rounded-r bg-primary"
            style={{ left: `calc(${regionLeft + regionWidth}% - 5px)` }}
            title="Çıkış noktası (O)"
          />
          <div className="absolute inset-y-0 w-4 -translate-x-1/2 cursor-grab" style={{ left: `${playPct}%` }}>
            <div className="mx-auto h-full w-0.5 bg-foreground" />
          </div>
        </div>
        <div className="mt-1.5 flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Zoom</span>
          <input
            type="range"
            min={zoomMin}
            max={duration}
            step={0.5}
            value={winLen}
            disabled={!hasDuration || disabled}
            onChange={(e) => {
              const len = Math.max(zoomMin, Math.min(duration, Number(e.target.value)));
              setZoomSec(len >= duration ? null : len);
              setViewStart((s) => Math.max(0, Math.min(duration - len, s)));
            }}
            className="flex-1 accent-primary"
            aria-label="Timeline yakınlaştırma"
          />
          <Button
            variant="ghost"
            size="sm"
            disabled={!hasDuration || zoomSec === null}
            onClick={() => {
              setZoomSec(null);
              setViewStart(0);
            }}
          >
            Sığdır
          </Button>
        </div>
        <div className="mt-1.5 flex items-center gap-2">
          <Input
            type="number"
            value={from}
            min={0}
            max={duration}
            step={0.1}
            onChange={(e) => {
              const n = Number(e.target.value);
              if (Number.isFinite(n)) onFromChange(clampT(n));
            }}
            disabled={disabled}
            aria-label="Başlangıç saniyesi"
          />
          <Input
            type="number"
            value={to}
            min={0}
            max={duration}
            step={0.1}
            onChange={(e) => {
              const n = Number(e.target.value);
              if (Number.isFinite(n)) onToChange(clampT(n));
            }}
            disabled={disabled}
            aria-label="Bitiş saniyesi"
          />
        </div>
      </div>
      {visibleThumbs.length > 0 && (
        <div className="flex gap-1 overflow-x-auto">
          {visibleThumbs.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => {
                const i = thumbs.indexOf(t);
                const v = videoRef.current;
                if (v && hasDuration) v.currentTime = clampT((duration * (i + 0.5)) / thumbs.length);
              }}
              className="shrink-0 overflow-hidden rounded border border-border"
              aria-label="Kareye git"
            >
              <img src={convertFileSrc(t)} alt="" className="h-10 w-auto" loading="lazy" />
            </button>
          ))}
        </div>
      )}
      {wave && winLen > 0 && (
        <div className="h-10 overflow-hidden rounded bg-muted">
          <div style={{ width: `${(duration / winLen) * 100}%`, marginLeft: `${-(winStart / winLen) * 100}%` }}>
            <img src={convertFileSrc(wave)} alt="Dalga formu" className="h-10 w-full object-cover" />
          </div>
        </div>
      )}
    </div>
  );
}
