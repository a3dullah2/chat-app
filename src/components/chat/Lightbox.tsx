"use client";

import { Download, X } from "lucide-react";
import { useUIStore } from "@/stores/ui-store";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

export function Lightbox() {
  const lightbox = useUIStore((s) => s.lightbox);
  const setLightbox = useUIStore((s) => s.setLightbox);

  return (
    <Dialog open={!!lightbox} onOpenChange={(open) => !open && setLightbox(null)}>
      <DialogContent
        className="sm:max-w-4xl p-2 bg-black/90 border-black/50 overflow-hidden"
        aria-describedby={undefined}
      >
        <div className="flex items-center justify-between p-2">
          <DialogTitle className="text-white/90 text-sm truncate max-w-[70%]">
            {lightbox?.alt ?? "Image"}
          </DialogTitle>
          <div className="flex items-center gap-1">
            {lightbox && (
              <Button
                asChild
                variant="ghost"
                size="icon"
                className="text-white/80 hover:text-white hover:bg-white/10"
              >
                <a href={lightbox.src} download aria-label="Download image">
                  <Download className="h-5 w-5" aria-hidden />
                </a>
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon"
              className="text-white/80 hover:text-white hover:bg-white/10"
              onClick={() => setLightbox(null)}
              aria-label="Close image viewer"
            >
              <X className="h-5 w-5" aria-hidden />
            </Button>
          </div>
        </div>
        {lightbox && (
           
          <img
            src={lightbox.src}
            alt={lightbox.alt}
            className="w-full max-h-[75vh] object-contain rounded-md"
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
