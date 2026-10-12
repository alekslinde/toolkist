import type { Alpine } from 'alpinejs';
import { fmtBytes, extOf } from '@/lib/utils';
import { wireDropZone, wireMultiDropZone } from '@/lib/file-dropzone';
import { imageResizeOp } from '@/lib/ops/image-resize';
import { OpError, type ParamValues } from '@/lib/ops/types';
import { wirePresetBar } from '@/lib/ops/param-sync';
import { wireBatchUi, renderChainButtons, TOOL_LABELS } from '@/lib/ops/batch-ui';
import { installGlobalHandlers, reportError, codeOf } from '@/lib/telemetry';

export function imageResizer() {
  return {
    helpful: 0,
    mode: 'single' as 'single' | 'batch',
    fileLoaded: false,
    processing: false,
    w: 800,
    h: 600,
    lockAspect: true,
    fit: 'contain',
    format: 'jpeg',
    padColor: '#ffffff',
    padColorHex: '#ffffff',
    origDims: '',
    progress: 0,
    status: '',
    statusType: 'info' as 'ok' | 'err' | 'info',
    previewSrc: '',
    _file: null as File | null,
    _img: null as HTMLImageElement | null,

    // Crop state
    thumbSrc: '',
    thumbScale: 1,
    cropX: 0, cropY: 0, cropW: 0, cropH: 0,
    aspectPreset: null as number | null,
    _drawing: false,
    _dragMode: 'draw' as string,
    _drawAnchor: { x: 0, y: 0 },
    _cropAtDragStart: { x: 0, y: 0, w: 0, h: 0 },
    presets: [
      { label: 'Free',  ratio: null },
      { label: '1∶1',  ratio: 1 },
      { label: '4∶3',  ratio: 4 / 3 },
      { label: '16∶9', ratio: 16 / 9 },
      { label: '3∶2',  ratio: 3 / 2 },
      { label: '9∶16', ratio: 9 / 16 },
      { label: '2∶3',  ratio: 2 / 3 },
    ],

    init() {
      installGlobalHandlers('image-resize');
      wireDropZone('ir-drop', {
        onFile: (file) => { this._load(file); },
        onClear: () => { this._clear(); },
        typeLabel: (file) => `${extOf(file.name).toUpperCase()} image`,
      });

      const self = this as any;
      function getParams(): ParamValues {
        return {
          width: parseInt(String(self.w), 10) || 1,
          height: parseInt(String(self.h), 10) || 1,
          fit: String(self.fit),
          format: String(self.format),
          padColor: String(self.padColor),
        };
      }
      function applyParams(values: ParamValues) {
        if (typeof values.width === 'number') self.w = values.width;
        if (typeof values.height === 'number') self.h = values.height;
        if (typeof values.fit === 'string') self.fit = values.fit;
        if (typeof values.format === 'string') self.format = values.format;
        if (typeof values.padColor === 'string') {
          self.padColor = values.padColor;
          self.padColorHex = values.padColor;
        }
      }
      wirePresetBar('ir-preset', { op: imageResizeOp, getParams, applyParams });

      // Batch mode shares the same geometry: one controller, one file list,
      // zip-or-single downloads and a Next-step chain — the same shell every
      // other batch tool uses. Crop stays out because it is per-file. The
      // controller also collects any chained handoff into its list.
      const from = sessionStorage.getItem('chain-from');
      const batch = wireBatchUi('irb', { op: imageResizeOp as never, getParams });
      wireMultiDropZone('ir-batch-drop', { onFiles: (f) => batch.add(f) });

      // A handed-over file lands in the batch list above; the first is also
      // loaded into the single-file crop view so a one-file chain starts
      // where it should. Several files switch straight to batch mode.
      const incoming = batch.files();
      if (incoming.length) {
        if (incoming.length > 1) self.mode = 'batch';
        this._load(
          incoming[0],
          `Carried over${from ? ` from ${TOOL_LABELS[from] ?? from}` : ''}${incoming.length > 1 ? ` — first of ${incoming.length} files shown for cropping` : ''} — drag thumbnail to crop, then Resize & Download.`,
        );
      }
    },

    /** Return to single mode and re-measure the thumbnail: a load that
     *  happened while hidden (multi-file handoff) leaves a 0-size canvas,
     *  and nothing else re-runs the sizing on reveal. */
    toSingle() {
      this.mode = 'single';
      (this as any).$nextTick(() => requestAnimationFrame(() => this.onThumbLoad()));
    },

    _clear() {
      this._file = null;
      this._img = null;
      this.fileLoaded = false;
      document.getElementById('ir-chain')?.setAttribute('hidden', '');
      if (this.previewSrc) URL.revokeObjectURL(this.previewSrc);
      this.previewSrc = '';
      this.thumbSrc = '';
      this.origDims = '';
      this.status = '';
    },

    _load(file: File, notice?: string) {
      this._file = file;
      document.getElementById('ir-chain')?.setAttribute('hidden', '');
      const reader = new FileReader();
      reader.onerror = () => {
        reportError('image-resize', 'IMAGE_DECODE_FAIL', { bytes: file.size, mime: file.type });
        this._setStatus('✕ This file could not be read.', 'err');
      };
      reader.onload = (ev) => {
        const img = new Image();
        img.onerror = () => {
          reportError('image-resize', 'IMAGE_DECODE_FAIL', { bytes: file.size, mime: file.type });
          this._setStatus('✕ This image could not be decoded.', 'err');
        };
        img.onload = () => {
          this._img = img;
          this.w = img.naturalWidth;
          this.h = img.naturalHeight;
          this.origDims = `${img.naturalWidth} × ${img.naturalHeight} px`;
          this.thumbSrc = ev.target!.result as string;
          this.cropW = 0;
          const ext = extOf(file.name);
          this.format = ext === 'png' ? 'png' : ext === 'webp' ? 'webp' : 'jpeg';
          this.fileLoaded = true;
          this._setStatus(notice ?? 'Loaded — drag thumbnail to crop, then Resize & Download.', 'info');
          (this as any).$nextTick(() => requestAnimationFrame(() => this.onThumbLoad()));
        };
        img.src = ev.target!.result as string;
      };
      reader.readAsDataURL(file);
    },

    onThumbLoad() {
      const img = (this as any).$refs.thumbImg as HTMLImageElement;
      const canvas = (this as any).$refs.cropCanvas as HTMLCanvasElement;
      if (!img || !canvas || !this._img) return;
      let dw = img.clientWidth, dh = img.clientHeight;
      if (dw === 0) {
        const maxH = 288, maxW = img.parentElement?.clientWidth ?? this._img.naturalWidth;
        const s = Math.min(maxW / this._img.naturalWidth, maxH / this._img.naturalHeight, 1);
        dw = Math.round(this._img.naturalWidth * s);
        dh = Math.round(this._img.naturalHeight * s);
      }
      // Hidden (batch mode): measuring now would zero a good canvas. The
      // Single toggle re-runs this once visible again.
      if (!dw || !dh) return;
      canvas.width = dw; canvas.height = dh;
      canvas.style.width = dw + 'px'; canvas.style.height = dh + 'px';
      this.thumbScale = this._img.naturalWidth / dw;
      this.drawOverlay();
    },

    drawOverlay() {
      const canvas = (this as any).$refs.cropCanvas as HTMLCanvasElement;
      if (!canvas) return;
      const ctx = canvas.getContext('2d')!;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (this.cropW < 2 || this.cropH < 2) return;

      const s = this.thumbScale;
      const rx = this.cropX / s, ry = this.cropY / s;
      const rw = this.cropW / s, rh = this.cropH / s;

      // Dark mask; clearRect punches through to the img beneath
      ctx.fillStyle = 'rgba(0,0,0,0.48)';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.clearRect(rx, ry, rw, rh);

      // Border + rule-of-thirds
      ctx.strokeStyle = 'rgba(168,85,247,0.9)';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(rx + 0.5, ry + 0.5, rw - 1, rh - 1);
      ctx.strokeStyle = 'rgba(168,85,247,0.3)';
      ctx.lineWidth = 0.5;
      for (let i = 1; i < 3; i++) {
        ctx.beginPath(); ctx.moveTo(rx + rw * i / 3, ry); ctx.lineTo(rx + rw * i / 3, ry + rh); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(rx, ry + rh * i / 3); ctx.lineTo(rx + rw, ry + rh * i / 3); ctx.stroke();
      }

      // Corner handles (10 px squares with white outline for contrast)
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1;
      ctx.fillStyle = '#a855f7';
      for (const [hx, hy] of [[rx, ry], [rx + rw, ry], [rx, ry + rh], [rx + rw, ry + rh]] as [number, number][]) {
        ctx.fillRect(hx - 5, hy - 5, 10, 10);
        ctx.strokeRect(hx - 5, hy - 5, 10, 10);
      }
    },

    // Returns the interaction zone under a thumb-coord point
    _hitTest(x: number, y: number): string {
      if (this.cropW < 2 || this.cropH < 2) return 'draw';
      const s = this.thumbScale;
      const rx = this.cropX / s, ry = this.cropY / s;
      const rw = this.cropW / s, rh = this.cropH / s;
      const R = 10;
      const corners: [string, number, number][] = [
        ['nw', rx,      ry      ],
        ['ne', rx + rw, ry      ],
        ['sw', rx,      ry + rh ],
        ['se', rx + rw, ry + rh ],
      ];
      for (const [name, cx, cy] of corners) {
        if (Math.abs(x - cx) <= R && Math.abs(y - cy) <= R) return name;
      }
      if (x > rx && x < rx + rw && y > ry && y < ry + rh) return 'move';
      return 'draw';
    },

    _getCursor(mode: string): string {
      return ({ draw: 'crosshair', move: 'move', nw: 'nw-resize', ne: 'ne-resize', sw: 'sw-resize', se: 'se-resize' } as Record<string,string>)[mode] ?? 'crosshair';
    },

    startDraw(e: PointerEvent) {
      const canvas = (this as any).$refs.cropCanvas as HTMLCanvasElement;
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left, y = e.clientY - rect.top;
      this._dragMode = this._hitTest(x, y);
      this._drawAnchor = { x, y };
      this._cropAtDragStart = { x: this.cropX, y: this.cropY, w: this.cropW, h: this.cropH };
      this._drawing = true;
      canvas.setPointerCapture(e.pointerId);
    },

    onMove(e: PointerEvent) {
      const canvas = (this as any).$refs.cropCanvas as HTMLCanvasElement;
      const rect = canvas.getBoundingClientRect();
      const x = Math.max(0, Math.min(canvas.width,  e.clientX - rect.left));
      const y = Math.max(0, Math.min(canvas.height, e.clientY - rect.top));

      if (!this._drawing) {
        canvas.style.cursor = this._getCursor(this._hitTest(x, y));
        return;
      }

      const s = this.thumbScale;
      const mode = this._dragMode;

      if (mode === 'draw') {
        let rx = Math.min(x, this._drawAnchor.x);
        let ry = Math.min(y, this._drawAnchor.y);
        let rw = Math.abs(x - this._drawAnchor.x);
        let rh = Math.abs(y - this._drawAnchor.y);
        if (this.aspectPreset !== null && rw > 0) {
          rh = rw / this.aspectPreset;
          if (ry + rh > canvas.height) { rh = canvas.height - ry; rw = rh * this.aspectPreset; }
        }
        this.cropX = Math.round(rx * s); this.cropY = Math.round(ry * s);
        this.cropW = Math.round(rw * s); this.cropH = Math.round(rh * s);

      } else if (mode === 'move') {
        const { x: ox, y: oy, w: ow, h: oh } = this._cropAtDragStart;
        const imgW = this._img!.naturalWidth, imgH = this._img!.naturalHeight;
        const dx = (x - this._drawAnchor.x) * s;
        const dy = (y - this._drawAnchor.y) * s;
        this.cropX = Math.round(Math.max(0, Math.min(imgW - ow, ox + dx)));
        this.cropY = Math.round(Math.max(0, Math.min(imgH - oh, oy + dy)));

      } else {
        // Corner resize — anchor is the opposite corner
        const { x: ox, y: oy, w: ow, h: oh } = this._cropAtDragStart;
        const anchorX = (mode === 'nw' || mode === 'sw' ? ox + ow : ox) / s;
        const anchorY = (mode === 'nw' || mode === 'ne' ? oy + oh : oy) / s;
        const fixedLeft = mode === 'nw' || mode === 'sw'; // anchor is on the right
        const fixedTop  = mode === 'nw' || mode === 'ne'; // anchor is at the bottom

        let rw = Math.abs(x - anchorX);
        let rh = this.aspectPreset !== null ? rw / this.aspectPreset : Math.abs(y - anchorY);

        // Clamp so the moving corner stays in-canvas
        const maxW = fixedLeft ? anchorX : canvas.width  - anchorX;
        const maxH = fixedTop  ? anchorY : canvas.height - anchorY;
        rw = Math.min(rw, maxW);
        rh = this.aspectPreset !== null ? rw / this.aspectPreset : Math.min(rh, maxH);
        if (this.aspectPreset !== null && rh > maxH) { rh = maxH; rw = rh * this.aspectPreset; }

        this.cropX = Math.round((fixedLeft ? anchorX - rw : anchorX) * s);
        this.cropY = Math.round((fixedTop  ? anchorY - rh : anchorY) * s);
        this.cropW = Math.round(rw * s);
        this.cropH = Math.round(rh * s);
      }

      if (this.aspectPreset !== null) this.h = Math.round(parseInt(String(this.w)) / this.aspectPreset) || 1;
      this.drawOverlay();
    },

    endDraw(_e: PointerEvent) {
      this._drawing = false;
      if (this.cropW < 4 || this.cropH < 4) { this.cropW = 0; this.cropH = 0; this.drawOverlay(); }
    },

    applyPreset(ratio: number | null) {
      this.aspectPreset = ratio;
      if (ratio === null || !this._img) return;
      const sw = this._img.naturalWidth, sh = this._img.naturalHeight;
      const newH = sw / ratio;
      if (newH <= sh) {
        this.cropX = 0; this.cropY = Math.round((sh - newH) / 2);
        this.cropW = sw; this.cropH = Math.round(newH);
      } else {
        const newW = sh * ratio;
        this.cropX = Math.round((sw - newW) / 2); this.cropY = 0;
        this.cropW = Math.round(newW); this.cropH = sh;
      }
      this.h = Math.round(parseInt(String(this.w)) / ratio) || 1;
      (this as any).$nextTick(() => this.drawOverlay());
    },

    clearCrop() {
      this.cropW = 0; this.cropH = 0; this.aspectPreset = null;
      this.drawOverlay();
    },

    onWChange() {
      if (!this.lockAspect || !this._img) return;
      const v = parseInt(String(this.w));
      if (!v) return;
      this.h = Math.round(v / (this._img.naturalWidth / this._img.naturalHeight)) || 1;
    },
    onHChange() {
      if (!this.lockAspect || !this._img) return;
      const v = parseInt(String(this.h));
      if (!v) return;
      this.w = Math.round(v * (this._img.naturalWidth / this._img.naturalHeight)) || 1;
    },
    syncPadHex(e: Event) {
      const val = (e.target as HTMLInputElement).value.trim();
      if (/^#[0-9a-fA-F]{6}$/.test(val)) this.padColor = val;
    },

    async resize() {
      if (!this._img || !this._file) return;
      const tw = parseInt(String(this.w)), th = parseInt(String(this.h));
      if (!tw || !th || tw < 1 || th < 1) { this._setStatus('✕ Enter valid width and height.', 'err'); return; }
      this.processing = true;
      this.progress = 20;
      try {
        // Crop stays local: it is a per-file interaction, so it produces the
        // op's *input* here rather than living in the op. Everything after
        // that — fit geometry, backdrop, encode, naming — is the op's, so the
        // page and batch path cannot disagree about what a fit mode means.
        let inputBytes: Uint8Array;
        let inputType: string;
        if (this.cropW > 4 && this.cropH > 4) {
          const cc = document.createElement('canvas');
          cc.width = this.cropW; cc.height = this.cropH;
          const cctx = cc.getContext('2d');
          if (!cctx) throw new OpError('CANVAS_UNAVAILABLE', 'Could not get a 2D context.');
          cctx.drawImage(this._img, this.cropX, this.cropY, this.cropW, this.cropH, 0, 0, this.cropW, this.cropH);
          const cropBlob = await new Promise<Blob | null>((res) => cc.toBlob(res, 'image/png'));
          if (!cropBlob) throw new OpError('ENCODE_FAILED', 'Could not crop the image.');
          inputBytes = new Uint8Array(await cropBlob.arrayBuffer());
          inputType = 'image/png';
        } else {
          inputBytes = new Uint8Array(await this._file.arrayBuffer());
          inputType = this._file.type;
        }

        const out = await imageResizeOp.run(
          { bytes: inputBytes, name: this._file.name, type: inputType },
          { width: tw, height: th, fit: String(this.fit), format: String(this.format), padColor: String(this.padColor) },
          { onProgress: (p) => { this.progress = Math.round(20 + p * 70); } },
        );

        if (this.previewSrc) URL.revokeObjectURL(this.previewSrc);
        this.previewSrc = URL.createObjectURL(out.blob);
        this._dl(out.blob, out.name);
        this.progress = 100;
        this._setStatus(`✓ Resized to ${tw}×${th} (${fmtBytes(out.blob.size)})`, 'ok');
        this._offerChain(out.blob, out.name);
      } catch (e: any) {
        reportError('image-resize', codeOf(e), {
          bytes: this._file?.size,
          mime: this._file?.type,
        });
        this._setStatus('✕ ' + (e?.message ?? 'Something went wrong.'), 'err');
      }
      setTimeout(() => { this.progress = 0; }, 1500);
      this.processing = false;
    },

    /** Single-mode Next step: same buttons the batch controller renders,
     *  over this one output. Shared helper, so the two cannot disagree. */
    _offerChain(blob: Blob, name: string) {
      const box = document.getElementById('ir-chain');
      if (!box) return;
      renderChainButtons(
        box,
        imageResizeOp as never,
        {
          width: parseInt(String(this.w), 10) || 1,
          height: parseInt(String(this.h), 10) || 1,
          fit: String(this.fit),
          format: String(this.format),
          padColor: String(this.padColor),
        },
        [{ blob, name }],
      );
    },

    _setStatus(msg: string, type: 'ok' | 'err' | 'info') { this.status = msg; this.statusType = type; },
    _dl(blob: Blob, name: string) {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = name;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    },
  };
}

export function registerImageResize(Alpine: Alpine) {
  Alpine.data('imageResizer', imageResizer);
}
