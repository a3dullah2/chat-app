"use client";

import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Camera, Loader2, LogOut, X } from "lucide-react";
import { api, uploadFile } from "@/lib/client-api";
import { Avatar } from "@/components/shared/Avatar";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { useUIStore } from "@/stores/ui-store";
import type { PublicUserDTO } from "@/types";

interface ProfileDialogProps {
  me: PublicUserDTO;
  onLogout?: () => void;
}

export function ProfileDialog({ me }: ProfileDialogProps) {
  const open = useUIStore((s) => s.profileOpen);
  const setOpen = useUIStore((s) => s.setProfileOpen);
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [name, setName] = useState(me.name);
  const [about, setAbout] = useState(me.about ?? "");
  const [avatarUrl, setAvatarUrl] = useState<string | null>(me.avatarUrl ?? null);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [saving, setSaving] = useState(false);

  const close = () => {
    setName(me.name);
    setAbout(me.about ?? "");
    setAvatarUrl(me.avatarUrl ?? null);
    setOpen(false);
  };

  const pickAvatar = () => fileInputRef.current?.click();

  const onAvatarChange = async (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error("Avatars must be images");
      return;
    }
    setUploadingAvatar(true);
    try {
      const attachment = await uploadFile(file, { kind: "avatar" });
      setAvatarUrl(attachment.url);
    } catch (error) {
      toast.error((error as Error).message || "Avatar upload failed");
    } finally {
      setUploadingAvatar(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const save = async () => {
    setSaving(true);
    try {
      const data = await api<{ user: PublicUserDTO }>("/api/users/me", {
        method: "PATCH",
        body: JSON.stringify({
          name: name.trim(),
          about: about.trim(),
          avatarUrl,
        }),
      });
      queryClient.setQueryData(["me"], data.user);
      queryClient.invalidateQueries({ queryKey: ["conversations"] });
      toast.success("Profile updated");
      close();
    } catch (error) {
      toast.error((error as Error).message || "Could not save your profile");
    } finally {
      setSaving(false);
    }
  };

  const dirty = name.trim() !== me.name || about !== (me.about ?? "") || avatarUrl !== (me.avatarUrl ?? null);
  const nameValid = name.trim().length >= 2 && name.trim().length <= 50;

  return (
    <Dialog open={open} onOpenChange={(value) => (value ? setOpen(true) : close())}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Profile</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col items-center gap-3 py-2">
          <button
            type="button"
            onClick={pickAvatar}
            className="relative rounded-full focus-visible:outline-2 focus-visible:outline-ring"
            aria-label="Change your avatar"
            disabled={uploadingAvatar}
          >
            <Avatar name={me.name} src={avatarUrl} size="xl" />
            <span className="absolute inset-0 rounded-full bg-black/40 flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity">
              {uploadingAvatar ? (
                <Loader2 className="h-6 w-6 text-white animate-spin" aria-hidden />
              ) : (
                <Camera className="h-6 w-6 text-white" aria-hidden />
              )}
            </span>
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            className="hidden"
            aria-hidden
            tabIndex={-1}
            onChange={(e) => onAvatarChange(e.target.files?.[0])}
          />
          {avatarUrl && (
            <button
              type="button"
              onClick={() => setAvatarUrl(null)}
              className="text-xs text-muted-foreground hover:text-destructive inline-flex items-center gap-1 focus-visible:outline-2 focus-visible:outline-ring rounded"
            >
              <X className="h-3 w-3" aria-hidden />
              Remove photo
            </button>
          )}
        </div>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="profile-name">Your name</Label>
            <Input
              id="profile-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={50}
              aria-invalid={!nameValid}
            />
            {!nameValid && (
              <p role="alert" className="text-xs text-destructive">
                Name must be 2–50 characters
              </p>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="profile-about">About</Label>
            <Input
              id="profile-about"
              value={about}
              onChange={(e) => setAbout(e.target.value)}
              maxLength={200}
              placeholder="Hey there! I am using ChatApp."
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Signed in as <span className="font-mono">{me.email}</span>
          </p>
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={close}>
            Cancel
          </Button>
          <Button onClick={save} disabled={!dirty || !nameValid || saving || uploadingAvatar}>
            {saving && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
            Save changes
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
