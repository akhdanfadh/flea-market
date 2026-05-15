import { standardSchemaResolver } from "@hookform/resolvers/standard-schema";
import { Link, createFileRoute, useRouter } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { ChevronLeftIcon } from "lucide-react";
import { nanoid } from "nanoid";
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
import { requireAdmin } from "@/lib/auth-middleware.ts";
import { draftItemPayloadSchema } from "@/lib/item-schema.ts";
import { generateUniqueSlug, withSlugErrorWrap } from "@/lib/slug.server.ts";
import { slugifyTitle } from "@/lib/slug.ts";

const createDraftItem = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .inputValidator(draftItemPayloadSchema)
  .handler(async ({ data }): Promise<{ slug: string }> => {
    const db = getDb();
    const id = nanoid(12);

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
    // Probe inside the tx so the slug-uniqueness check and the insert
    // observe the same snapshot; withSlugErrorWrap translates a UNIQUE
    // collision at commit into a friendly message instead of the raw
    // libsql error.
    const slug = await withSlugErrorWrap(() =>
      db.transaction(async (tx) => {
        const resolved = await generateUniqueSlug(data.slug, tx);
        await tx.insert(items).values({
          id,
          slug: resolved,
          priceAmount: null,
          priceCurrency: null,
          status: "draft",
          photos: [],
        });
        await tx.insert(itemTranslations).values(translationRows);
        return resolved;
      }),
    );
    return { slug };
  });

export const Route = createFileRoute("/admin/_auth/new")({
  component: NewItemPage,
});

function NewItemPage() {
  const router = useRouter();
  // Slug toggles between auto-preview (derived from the EN title on each
  // keystroke) and manual edit. The toggle is reversible - clicking
  // "Auto-generate" while in manual mode resumes the title-derived preview
  // (and overwrites whatever the admin typed on the next effect tick).
  const [slugManuallyEdited, setSlugManuallyEdited] = useState(false);
  const [idEnabled, setIdEnabled] = useState(false);

  // onTouched validates after each field's first blur (then re-validates on
  // change while the error is showing). The admin types freely; tabbing
  // away from an invalid slug like "My Item!" surfaces the error instead
  // of holding it until Save.
  const form = useForm<DraftItemPayload>({
    resolver: standardSchemaResolver(draftItemPayloadSchema),
    mode: "onTouched",
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

  // onTouched fires the slug validator on first blur regardless of mode -
  // even when readOnly. In auto mode the admin can't fix the slug directly
  // (it derives from the title), so a red error here would be confusing
  // and stick around until they type a title. Suppress it by clearing
  // whenever it surfaces in auto mode; schema validation still fires on
  // Save so a genuinely invalid slug never persists.
  const slugError = form.formState.errors.slug;
  useEffect(() => {
    if (!slugManuallyEdited && slugError) {
      form.clearErrors("slug");
    }
  }, [slugError, slugManuallyEdited, form]);

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
                <div className="flex items-center gap-2">
                  <Input
                    id="slug"
                    {...field}
                    readOnly={!slugManuallyEdited}
                    maxLength={100}
                    aria-invalid={fieldState.invalid}
                    className="font-mono"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setSlugManuallyEdited((v) => !v)}
                  >
                    {slugManuallyEdited ? "Auto-generate slug" : "Edit slug manually"}
                  </Button>
                </div>
                <FieldDescription>
                  Auto-generated from the English title and today's date, or edit it manually. The
                  final slug may be suffixed with -2, -3 if it collides with an existing item.
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
