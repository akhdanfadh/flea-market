import { standardSchemaResolver } from "@hookform/resolvers/standard-schema";
import { Link, createFileRoute, redirect, useRouter } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { getCookie } from "@tanstack/react-start/server";
import { env } from "cloudflare:workers";
import { ChevronLeftIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";

import type { DraftItemPayload } from "@/lib/item-schema.ts";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { getDb } from "@/db/client.ts";
import { itemTranslations, items } from "@/db/schema.ts";
import { ADMIN_SESSION_COOKIE, isAdminSession } from "@/lib/auth.server.ts";
import { draftItemPayloadSchema } from "@/lib/item-schema.ts";
import { generateUniqueSlug } from "@/lib/slug.server.ts";
import { slugifyTitle } from "@/lib/slug.ts";

const createDraftItem = createServerFn({ method: "POST" })
  .inputValidator(draftItemPayloadSchema)
  .handler(async ({ data }): Promise<{ slug: string }> => {
    if (!(await isAdminSession(getCookie(ADMIN_SESSION_COOKIE), env.COOKIE_SECRET))) {
      throw redirect({ to: "/admin/login/" });
    }
    const db = getDb();
    const id = crypto.randomUUID();
    const slug = await generateUniqueSlug(data.slug, db);

    // Schema default for status is "available"; drafts opt in explicitly.
    // The translation schema already .trim()s as a transform, so values
    // here arrive whitespace-stripped.
    const translationRows = [
      {
        itemId: id,
        language: "en" as const,
        title: data.translations.en.title,
        description: data.translations.en.description,
      },
      ...(data.translations.id
        ? [
            {
              itemId: id,
              language: "id" as const,
              title: data.translations.id.title,
              description: data.translations.id.description,
            },
          ]
        : []),
    ];
    await db.transaction(async (tx) => {
      await tx.insert(items).values({
        id,
        slug,
        priceAmount: null,
        priceCurrency: null,
        status: "draft",
        photos: [],
      });
      await tx.insert(itemTranslations).values(translationRows);
    });
    return { slug };
  });

export const Route = createFileRoute("/admin/_auth/new")({
  component: NewItemPage,
});

function NewItemPage() {
  const router = useRouter();
  // Edit slug is opt-in: the form previews a slug live from the EN title
  // until the admin clicks "Edit slug". After that the auto-sync stops so
  // the admin's manual value isn't overwritten on every keystroke.
  const [slugManuallyEdited, setSlugManuallyEdited] = useState(false);
  const [idEnabled, setIdEnabled] = useState(false);

  const form = useForm<DraftItemPayload>({
    resolver: standardSchemaResolver(draftItemPayloadSchema),
    defaultValues: {
      slug: "",
      translations: { en: { title: "", description: "" }, id: undefined },
    },
  });

  const enTitle = form.watch("translations.en.title");

  useEffect(() => {
    if (slugManuallyEdited) return;
    // Skip the auto-preview while the title is blank - otherwise the effect
    // fires on mount with empty enTitle, slugifyTitle("") returns just the
    // date prefix, and the slug field hydrates into "20260515" before the
    // admin types anything. Visually noisy hydration jump.
    if (!enTitle?.trim()) {
      form.setValue("slug", "", { shouldValidate: false });
      return;
    }
    form.setValue("slug", slugifyTitle(enTitle), { shouldValidate: false });
  }, [enTitle, slugManuallyEdited, form]);

  // Park whatever the admin typed into the ID translation fields when they
  // uncheck the toggle, restore on re-check. Without this, a stray click on
  // the checkbox wipes out the typed Indonesian content with no recovery.
  const idParkedRef = useRef<{ title: string; description: string }>({
    title: "",
    description: "",
  });

  function toggleId(next: boolean) {
    setIdEnabled(next);
    if (next) {
      form.setValue("translations.id", idParkedRef.current, { shouldDirty: true });
    } else {
      const current = form.getValues("translations.id");
      if (current) idParkedRef.current = current;
      form.setValue("translations.id", undefined, { shouldDirty: true });
    }
  }

  async function onFormSubmit(payload: DraftItemPayload) {
    // Drive toast.promise with the save itself, NOT bundled with navigate -
    // if navigate fails after a successful save, the user must see "Draft
    // saved" (the row really is there) rather than "Failed to save draft"
    // (which would prompt a retry and produce a duplicate via the slug
    // auto-suffix). Same nuance as the delete flow's exotic-case NOTE.
    const savePromise = createDraftItem({ data: payload });
    toast.promise(savePromise, {
      loading: "Saving draft...",
      success: (result) => ({
        message: "Draft saved",
        description: `Created as ${result.slug}. Add photos and a price next.`,
      }),
      error: (err: unknown) => ({
        message: "Failed to save draft",
        description: err instanceof Error ? err.message : String(err),
      }),
    });
    let result: { slug: string };
    try {
      result = await savePromise;
    } catch {
      // toast.promise already surfaced the save error; quiet RHF.
      return;
    }
    try {
      await router.navigate({ to: "/admin/$slug/edit/", params: { slug: result.slug } });
    } catch {
      // Save succeeded server-side; only the navigate failed (rare - loader
      // crash or session expiring mid-request). The success toast already
      // fired, so the admin knows the row is saved; they can reload to
      // reach the edit page. Quiet swallow keeps RHF from logging.
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <Link
        to="/admin/"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeftIcon className="size-4" />
        Back to items
      </Link>
      <h2 className="text-base font-semibold">New item</h2>
      <p className="text-sm text-muted-foreground">
        Save a draft with the minimum required fields. Photos, price, and publish happen on the edit
        page once the draft exists.
      </p>

      <form onSubmit={form.handleSubmit(onFormSubmit)}>
        <FieldGroup>
          <FieldSet>
            <FieldLegend>English</FieldLegend>
            <FieldGroup>
              <Controller
                control={form.control}
                name="translations.en.title"
                render={({ field, fieldState }) => (
                  <Field data-invalid={fieldState.invalid || undefined}>
                    <FieldLabel htmlFor="en-title">Title</FieldLabel>
                    <Input id="en-title" {...field} aria-invalid={fieldState.invalid} />
                    <FieldError errors={[fieldState.error]} />
                  </Field>
                )}
              />
              <Controller
                control={form.control}
                name="translations.en.description"
                render={({ field, fieldState }) => (
                  <Field data-invalid={fieldState.invalid || undefined}>
                    <FieldLabel htmlFor="en-desc">Description</FieldLabel>
                    <Textarea id="en-desc" {...field} rows={4} aria-invalid={fieldState.invalid} />
                    <FieldError errors={[fieldState.error]} />
                  </Field>
                )}
              />
            </FieldGroup>
          </FieldSet>

          <Field orientation="horizontal">
            <Checkbox id="add-id-translation" checked={idEnabled} onCheckedChange={toggleId} />
            <FieldLabel htmlFor="add-id-translation">Add Indonesian translation</FieldLabel>
          </Field>

          {idEnabled && (
            <FieldSet>
              <FieldLegend>Indonesian</FieldLegend>
              <FieldGroup>
                <Controller
                  control={form.control}
                  name="translations.id.title"
                  render={({ field, fieldState }) => (
                    <Field data-invalid={fieldState.invalid || undefined}>
                      <FieldLabel htmlFor="id-title">Title</FieldLabel>
                      <Input
                        id="id-title"
                        {...field}
                        value={field.value ?? ""}
                        aria-invalid={fieldState.invalid}
                      />
                      <FieldError errors={[fieldState.error]} />
                    </Field>
                  )}
                />
                <Controller
                  control={form.control}
                  name="translations.id.description"
                  render={({ field, fieldState }) => (
                    <Field data-invalid={fieldState.invalid || undefined}>
                      <FieldLabel htmlFor="id-desc">Description</FieldLabel>
                      <Textarea
                        id="id-desc"
                        {...field}
                        value={field.value ?? ""}
                        rows={4}
                        aria-invalid={fieldState.invalid}
                      />
                      <FieldError errors={[fieldState.error]} />
                    </Field>
                  )}
                />
              </FieldGroup>
            </FieldSet>
          )}

          <Controller
            control={form.control}
            name="slug"
            render={({ field, fieldState }) => (
              <Field data-invalid={fieldState.invalid || undefined}>
                <FieldLabel htmlFor="slug">URL slug</FieldLabel>
                <div className="flex gap-2">
                  <Input
                    id="slug"
                    {...field}
                    readOnly={!slugManuallyEdited}
                    maxLength={100}
                    aria-invalid={fieldState.invalid}
                    className="font-mono"
                  />
                  {!slugManuallyEdited && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setSlugManuallyEdited(true)}
                    >
                      Edit slug
                    </Button>
                  )}
                </div>
                <FieldDescription>
                  Auto-generated from the English title and today's date. The final slug may be
                  suffixed with -2, -3 if it collides with an existing item; the toast on save shows
                  what was actually stored.
                </FieldDescription>
                <FieldError errors={[fieldState.error]} />
              </Field>
            )}
          />

          <div className="flex justify-end gap-2 pt-2">
            <Button type="submit" disabled={form.formState.isSubmitting}>
              {form.formState.isSubmitting ? "Saving..." : "Save draft"}
            </Button>
          </div>
        </FieldGroup>
      </form>
    </div>
  );
}
