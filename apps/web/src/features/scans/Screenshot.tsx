import type { BoundingBox } from '@whc/shared';
import { Download, ImageOff } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { screenshotUrl } from './api';

/**
 * A stored screenshot, loaded through the API (permission-checked, cookie-authenticated).
 * When a bounding box is given, the problem element is outlined on top of the image,
 * scaled to the displayed size.
 */
export function ScreenshotImage({
  id,
  alt,
  box,
  imageWidth,
  className,
}: {
  id: string;
  alt: string;
  box?: BoundingBox | null;
  imageWidth?: number;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const [rendered, setRendered] = useState<{ width: number; natural: number } | null>(null);

  if (failed) {
    return (
      <div className="flex h-32 items-center justify-center gap-2 rounded-md border bg-muted text-sm text-muted-foreground">
        <ImageOff className="size-4" aria-hidden="true" /> Screenshot unavailable
      </div>
    );
  }
  const scale = rendered ? rendered.width / (imageWidth ?? rendered.natural) : 0;
  return (
    <div className={`relative overflow-hidden rounded-md border bg-muted ${className ?? ''}`}>
      <img
        src={screenshotUrl(id)}
        alt={alt}
        loading="lazy"
        className="block h-auto w-full"
        onError={() => setFailed(true)}
        onLoad={(event) =>
          setRendered({
            width: event.currentTarget.clientWidth,
            natural: event.currentTarget.naturalWidth,
          })
        }
      />
      {box && scale > 0 ? (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute rounded-sm border-2 border-red-600 bg-red-600/15"
          style={{
            left: box.x * scale - 2,
            top: box.y * scale - 2,
            width: box.width * scale + 4,
            height: box.height * scale + 4,
          }}
        />
      ) : null}
    </div>
  );
}

/** Thumbnail that opens the full screenshot in a dialog, with a download link. */
export function ScreenshotPreview(props: {
  id: string;
  title: string;
  box?: BoundingBox | null;
  imageWidth?: number;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="block w-full max-w-sm cursor-zoom-in text-left focus-visible:outline-2"
        aria-label={`Open screenshot: ${props.title}`}
      >
        <ScreenshotImage
          id={props.id}
          alt={props.title}
          box={props.box}
          imageWidth={props.imageWidth}
          className="max-h-64"
        />
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-5xl">
          <DialogHeader>
            <DialogTitle>{props.title}</DialogTitle>
            <DialogDescription>
              Screenshot captured by the scanner. The highlighted area is the affected element.
            </DialogDescription>
          </DialogHeader>
          <ScreenshotImage
            id={props.id}
            alt={props.title}
            box={props.box}
            imageWidth={props.imageWidth}
          />
          <Button asChild variant="outline" size="sm" className="justify-self-start">
            <a href={screenshotUrl(props.id, true)}>
              <Download aria-hidden="true" /> Download
            </a>
          </Button>
        </DialogContent>
      </Dialog>
    </>
  );
}
