import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import {
  Building2,
  CalendarClock,
  Check,
  CircleDollarSign,
  Clock3,
  Image as ImageIcon,
  Info,
  Plus,
  Sparkles,
  Trash2,
} from 'lucide-react';
import {
  createFacility,
  deleteFacilityImage,
  setFacilityAvailability,
  updateFacility,
  uploadFacilityImages,
} from './actions';
import { Modal } from './components';
import { useRows } from './data';
import {
  first,
  str,
  type FacilityImage,
  type FacilityPricingMode,
  type Row,
  type Session,
  type UpdateFacilityInput,
} from './models';

const facilityTypes = [
  'Gym',
  'Swimming Pool',
  'Clubhouse',
  'Function Hall',
  'Sports Court',
  'Playground',
  'Garden / Park',
  'Meeting Room',
  'Multipurpose Hall',
  'Recreation Area',
];

type SlotEditor = {
  id: number;
  start: string;
  end: string;
  raw?: string;
};

const FACILITY_IMAGE_LIMIT = 6;

type GalleryItem =
  | { id: string; kind: 'stored'; image: FacilityImage; previewUrl: string }
  | { id: string; kind: 'new'; file: File; previewUrl: string };

function storedFacilityImages(row?: Row): FacilityImage[] {
  const raw = row?.data.images;
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
    const candidate = value as Record<string, unknown>;
    const url = str(candidate.url);
    const storagePath = str(candidate.storagePath);
    if (!url || !storagePath) return [];
    return [{ url, storagePath, ...(str(candidate.name) ? { name: str(candidate.name) } : {}) }];
  }).slice(0, FACILITY_IMAGE_LIMIT);
}

function toMinutes(value: string) {
  const match = value.trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i);
  if (!match) return null;

  let hour = Number(match[1]);
  const minute = Number(match[2]);
  const meridiem = match[3]?.toUpperCase();

  if (!Number.isFinite(hour) || !Number.isFinite(minute) || minute > 59) return null;

  if (meridiem) {
    if (hour < 1 || hour > 12) return null;
    if (meridiem === 'AM' && hour === 12) hour = 0;
    if (meridiem === 'PM' && hour !== 12) hour += 12;
  } else if (hour > 23) {
    return null;
  }

  return hour * 60 + minute;
}

function minutesTo24(minutes: number) {
  const normalized = ((minutes % 1440) + 1440) % 1440;
  const hour = Math.floor(normalized / 60);
  const minute = normalized % 60;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function time24ToDisplay(value: string) {
  const minutes = toMinutes(value);
  if (minutes == null) return value;
  const hour24 = Math.floor(minutes / 60);
  const minute = minutes % 60;
  const suffix = hour24 >= 12 ? 'PM' : 'AM';
  const hour12 = hour24 % 12 || 12;
  return `${hour12}:${String(minute).padStart(2, '0')} ${suffix}`;
}

function parseStoredSlot(value: string, id: number): SlotEditor {
  const parts = value.split(/\s*(?:-|–|—|to)\s*/i).filter(Boolean);
  if (parts.length === 2) {
    const startMinutes = toMinutes(parts[0]);
    const endMinutes = toMinutes(parts[1]);
    if (startMinutes != null && endMinutes != null) {
      return {
        id,
        start: minutesTo24(startMinutes),
        end: minutesTo24(endMinutes),
      };
    }
  }

  return { id, start: '', end: '', raw: value };
}

function serializeSlot(slot: SlotEditor) {
  if (slot.raw !== undefined) return slot.raw.trim();
  if (!slot.start || !slot.end) return '';
  return `${time24ToDisplay(slot.start)} - ${time24ToDisplay(slot.end)}`;
}

function initialValues(row?: Row) {
  const data = row?.data || {};

  const pricingMode: FacilityPricingMode =
    data.pricingMode === 'free' ||
    data.pricingMode === 'flat' ||
    data.pricingMode === 'resident_type'
      ? data.pricingMode
      : row
        ? data.isFree === true
          ? 'free'
          : 'flat'
        : 'free';

  return {
    name: str(data.name),
    type: str(data.type),
    description: str(data.description),
    iconName: str(data.iconName),
    pricingMode,
    isFree: pricingMode === 'free',
    price: typeof data.pricePerDay === 'number' ? String(data.pricePerDay) : '',
    ownerPrice:
      typeof data.ownerPricePerDay === 'number' ? String(data.ownerPricePerDay) : '',
    tenantPrice:
      typeof data.tenantPricePerDay === 'number' ? String(data.tenantPricePerDay) : '',
    isAvailable: row ? data.isAvailable !== false : true,
    timeSlots: Array.isArray(data.timeSlots)
      ? data.timeSlots.filter((slot): slot is string => typeof slot === 'string').map(str)
      : [],
  };
}

export function FacilityForm({
  s,
  row,
  onClose,
  onSaved,
}: {
  s: Session;
  row?: Row;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [initial] = useState(() => initialValues(row));
  const [values, setValues] = useState(initial);
  const [typeOption, setTypeOption] = useState(() =>
    facilityTypes.includes(initial.type) ? initial.type : initial.type ? 'Other' : '',
  );
  const [customType, setCustomType] = useState(() =>
    facilityTypes.includes(initial.type) ? '' : initial.type,
  );
  const [slots, setSlots] = useState<SlotEditor[]>(() =>
    initial.timeSlots.map((value, id) => parseStoredSlot(value, id)),
  );
  const legacyImageUrl = str(row?.data.imageUrl);
  const initialStoredImages = useMemo(() => storedFacilityImages(row), [row]);
  const [gallery, setGallery] = useState<GalleryItem[]>(() =>
    initialStoredImages.map((image, index) => ({
      id: `stored-${index}-${image.storagePath}`,
      kind: 'stored' as const,
      image,
      previewUrl: image.url,
    })),
  );
  const [legacyImageRemoved, setLegacyImageRemoved] = useState(false);
  const [galleryTouched, setGalleryTouched] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const objectUrls = useRef(new Set<string>());
  const nextSlot = useRef(slots.length);
  const [buildingId, setBuildingId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [generatorStart, setGeneratorStart] = useState('06:00');
  const [generatorEnd, setGeneratorEnd] = useState('22:00');
  const [generatorDuration, setGeneratorDuration] = useState('60');
  const saving = useRef(false);
  const mounted = useRef(true);
  const container = useRef<HTMLDivElement>(null);
  const buildings = useRows(s, 'buildings');

  useEffect(() => {
    mounted.current = true;
    const element = container.current;
    const preventDismiss = (event: Event) => {
      if (saving.current) event.preventDefault();
    };
    element?.addEventListener('cancel', preventDismiss, true);
    return () => {
      mounted.current = false;
      element?.removeEventListener('cancel', preventDismiss, true);
    };
  }, []);

  useEffect(() => {
    return () => {
      for (const url of objectUrls.current) URL.revokeObjectURL(url);
      objectUrls.current.clear();
    };
  }, []);

  const buildingOptions = buildings.rows
    .map((building) => ({
      id: building.id,
      name: first(building.data, ['buildingName', 'name'], building.id),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const slotStrings = useMemo(() => slots.map(serializeSlot), [slots]);
  const primaryPreview = gallery[0]?.previewUrl || (!legacyImageRemoved ? legacyImageUrl : '');

  function selectImages(files: FileList | null) {
    if (!files?.length) return;
    const incoming = Array.from(files);
    if (gallery.length + incoming.length > FACILITY_IMAGE_LIMIT) {
      setError(`A facility can have at most ${FACILITY_IMAGE_LIMIT} images.`);
      if (fileInput.current) fileInput.current.value = '';
      return;
    }

    const invalid = incoming.find(
      (file) => !['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size <= 0 || file.size > 5 * 1024 * 1024,
    );
    if (invalid) {
      setError('Choose JPG, PNG or WebP images no larger than 5 MB each.');
      if (fileInput.current) fileInput.current.value = '';
      return;
    }

    const next = incoming.map((file, index): GalleryItem => {
      const previewUrl = typeof URL.createObjectURL === 'function' ? URL.createObjectURL(file) : '';
      if (previewUrl.startsWith('blob:')) objectUrls.current.add(previewUrl);
      return {
        id: `new-${Date.now()}-${index}-${file.name}`,
        kind: 'new',
        file,
        previewUrl,
      };
    });
    setGallery((current) => [...current, ...next]);
    setGalleryTouched(true);
    setLegacyImageRemoved(true);
    setError('');
    if (fileInput.current) fileInput.current.value = '';
  }

  function removeGalleryItem(id: string) {
    setGallery((current) => {
      const target = current.find((item) => item.id === id);
      if (target?.kind === 'new' && target.previewUrl.startsWith('blob:')) {
        URL.revokeObjectURL(target.previewUrl);
        objectUrls.current.delete(target.previewUrl);
      }
      return current.filter((item) => item.id !== id);
    });
    setGalleryTouched(true);
  }

  function makePrimary(id: string) {
    setGallery((current) => {
      const index = current.findIndex((item) => item.id === id);
      if (index <= 0) return current;
      const next = [...current];
      const [selected] = next.splice(index, 1);
      next.unshift(selected);
      return next;
    });
    setGalleryTouched(true);
    setLegacyImageRemoved(true);
  }

  const previewPrice =
    values.pricingMode === 'free'
      ? 'Free'
      : values.pricingMode === 'flat'
        ? values.price.trim()
          ? `₱${values.price} / day`
          : 'Fee not set'
        : values.ownerPrice.trim() || values.tenantPrice.trim()
          ? `Owner ₱${values.ownerPrice || '—'} · Tenant ₱${values.tenantPrice || '—'}`
          : 'Fees not set';

  function close() {
    if (!saving.current) onClose();
  }

  function addEmptySlot() {
    setSlots((current) => [
      ...current,
      { id: nextSlot.current++, start: '', end: '' },
    ]);
  }

  function generateSlots() {
    const start = toMinutes(generatorStart);
    const end = toMinutes(generatorEnd);
    const duration = Number(generatorDuration);

    if (start == null || end == null || end <= start) {
      setError('Choose a valid opening and closing time. Closing time must be later.');
      return;
    }
    if (!Number.isFinite(duration) || duration < 15) {
      setError('Choose a valid slot duration.');
      return;
    }

    const generated: SlotEditor[] = [];
    for (let cursor = start; cursor + duration <= end; cursor += duration) {
      generated.push({
        id: nextSlot.current++,
        start: minutesTo24(cursor),
        end: minutesTo24(cursor + duration),
      });
    }

    if (!generated.length) {
      setError('The selected hours are shorter than the slot duration.');
      return;
    }

    setError('');
    setSlots(generated);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving.current) return;
    setError('');

    try {
      if (typeOption === 'Other' && !values.type.trim()) throw Error('Specify a facility type.');

      const fields: UpdateFacilityInput = {};
      for (const key of ['name', 'type', 'description', 'iconName'] as const) {
        const value = values[key].trim();
        if (!row || value !== initial[key]) {
          if ((key === 'name' || key === 'type') && !value)
            throw Error(key === 'name' ? 'Enter a facility name.' : 'Enter a facility type.');
          fields[key] = value;
        }
      }

      if (slots.some((slot) => slot.raw === undefined && (!slot.start || !slot.end))) {
        throw Error('Complete the start and end time for every booking slot, or remove the empty slot.');
      }

      for (const slot of slots) {
        if (slot.raw !== undefined) {
          if (!slot.raw.trim()) throw Error('Enter a value for every legacy slot, or remove it.');
          continue;
        }
        const start = toMinutes(slot.start);
        const end = toMinutes(slot.end);
        if (start == null || end == null || end <= start)
          throw Error('Each booking slot must end after it starts.');
      }

      const timeSlots = slotStrings.map((slot) => slot.trim());
      if (!row || JSON.stringify(timeSlots) !== JSON.stringify(initial.timeSlots)) {
        fields.timeSlots = timeSlots;
      }

      const pricingChanged =
        !row ||
        values.pricingMode !== initial.pricingMode ||
        values.price !== initial.price ||
        values.ownerPrice !== initial.ownerPrice ||
        values.tenantPrice !== initial.tenantPrice;

      if (pricingChanged) {
        const isFree = values.pricingMode === 'free';
        fields.isFree = isFree;
        fields.pricingMode = values.pricingMode;

        if (values.pricingMode === 'free') {
          fields.pricePerDay = 0;
        } else if (values.pricingMode === 'flat') {
          if (!values.price.trim()) throw Error('Enter a fee per day.');
          const price = Number(values.price);
          if (!Number.isFinite(price) || price < 0)
            throw Error('Enter a fee per day of 0 or more.');
          fields.pricePerDay = price;
        } else {
          if (!values.ownerPrice.trim()) throw Error('Enter the Owner fee per day.');
          if (!values.tenantPrice.trim()) throw Error('Enter the Tenant / Lease fee per day.');

          const ownerPrice = Number(values.ownerPrice);
          const tenantPrice = Number(values.tenantPrice);
          if (!Number.isFinite(ownerPrice) || ownerPrice < 0)
            throw Error('Enter an Owner fee per day of 0 or more.');
          if (!Number.isFinite(tenantPrice) || tenantPrice < 0)
            throw Error('Enter a Tenant / Lease fee per day of 0 or more.');

          fields.pricePerDay = 0;
          fields.ownerPricePerDay = ownerPrice;
          fields.tenantPricePerDay = tenantPrice;
        }
      }

      if (!row && (buildings.loading || buildings.error || !buildingId))
        throw Error('Select a building before saving.');

      const availabilityChanged = row && values.isAvailable !== initial.isAvailable;
      const hasNewImages = gallery.some((item) => item.kind === 'new');
      const galleryChanged = galleryTouched || hasNewImages || legacyImageRemoved;
      if (row && !Object.keys(fields).length && !availabilityChanged && !galleryChanged) {
        setError('No changes to save.');
        return;
      }

      saving.current = true;
      setBusy(true);

      if (row) {
        const uploaded: FacilityImage[] = hasNewImages
          ? await uploadFacilityImages(
              s,
              row.id,
              gallery.filter((item): item is Extract<GalleryItem, { kind: 'new' }> => item.kind === 'new').map((item) => item.file),
            )
          : [];
        const removedStored = initialStoredImages.filter(
          (image) => !gallery.some((item) => item.kind === 'stored' && item.image.storagePath === image.storagePath),
        );
        const finalImages: FacilityImage[] = [];
        let uploadedIndex = 0;
        for (const item of gallery) {
          finalImages.push(item.kind === 'stored' ? item.image : uploaded[uploadedIndex++]);
        }

        try {
          if (galleryChanged) fields.images = finalImages;
          if (Object.keys(fields).length) await updateFacility(s, row.id, fields);
          if (availabilityChanged) await setFacilityAvailability(s, row.id, values.isAvailable);
        } catch (error) {
          await Promise.allSettled(uploaded.map((image) => deleteFacilityImage(s, row.id, image)));
          throw error;
        }
        await Promise.allSettled(removedStored.map((image) => deleteFacilityImage(s, row.id, image)));
      } else {
        const created = await createFacility(s, {
          name: fields.name!,
          type: fields.type!,
          description: fields.description,
          iconName: fields.iconName,
          timeSlots: fields.timeSlots!,
          isFree: fields.isFree!,
          pricingMode: fields.pricingMode!,
          pricePerDay: fields.pricePerDay!,
          ...(fields.ownerPricePerDay !== undefined
            ? { ownerPricePerDay: fields.ownerPricePerDay }
            : {}),
          ...(fields.tenantPricePerDay !== undefined
            ? { tenantPricePerDay: fields.tenantPricePerDay }
            : {}),
          buildingId,
          isAvailable: values.isAvailable,
        });

        if (gallery.some((item) => item.kind === 'new')) {
          const uploaded = await uploadFacilityImages(
            s,
            created.id,
            gallery.filter((item): item is Extract<GalleryItem, { kind: 'new' }> => item.kind === 'new').map((item) => item.file),
          );
          await updateFacility(s, created.id, { images: uploaded });
        }
      }

      if (mounted.current) onSaved();
    } catch (error) {
      setError(
        error instanceof Error ? error.message : 'Unable to save the facility. Please try again.',
      );
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }

  return (
    <div ref={container} className="facility-form-host">
      <Modal title={row ? 'Edit facility' : 'Add facility'} onClose={close}>
        <form
          className="facility-admin-form"
          aria-label="Facility form"
          onSubmit={submit}
          noValidate
          aria-busy={busy}
        >
          <fieldset disabled={busy} className="facility-form-fieldset">
            <div className="facility-form-intro">
              <div>
                <span className="facility-form-kicker">FACILITY MANAGEMENT</span>
                <h2>{row ? 'Update facility details' : 'Create a new facility'}</h2>
                <p>
                  Configure facility information, booking slots, pricing and availability from one
                  screen.
                </p>
              </div>
              <span className={`facility-availability-chip ${values.isAvailable ? 'active' : 'inactive'}`}>
                <span /> {values.isAvailable ? 'Active' : 'Inactive'}
              </span>
            </div>

            <div className="facility-form-layout">
              <div className="facility-form-main">
                <section className="facility-form-section">
                  <div className="facility-section-heading">
                    <span className="facility-section-icon"><Info size={18} /></span>
                    <div>
                      <h3>Basic information</h3>
                      <p>The details residents will see on the facility card.</p>
                    </div>
                  </div>

                  <div className="facility-field-grid two">
                    <label>
                      <span>Facility name *</span>
                      <input
                        required
                        placeholder="e.g. Swimming Pool"
                        value={values.name}
                        onChange={(e) => setValues({ ...values, name: e.target.value })}
                      />
                    </label>

                    <label>
                      <span>Facility type *</span>
                      <select
                        required
                        value={typeOption}
                        onChange={(e) => {
                          const option = e.target.value;
                          setTypeOption(option);
                          setValues({ ...values, type: option === 'Other' ? customType : option });
                        }}
                      >
                        <option value="">Select facility type</option>
                        {facilityTypes.map((type) => (
                          <option key={type} value={type}>{type}</option>
                        ))}
                        <option value="Other">Other</option>
                      </select>
                    </label>
                  </div>

                  {typeOption === 'Other' && (
                    <label>
                      <span>Custom facility type *</span>
                      <input
                        required
                        placeholder="Enter facility type"
                        value={customType}
                        onChange={(e) => {
                          setCustomType(e.target.value);
                          setValues({ ...values, type: e.target.value });
                        }}
                      />
                    </label>
                  )}

                  <label>
                    <span>Description</span>
                    <textarea
                      rows={4}
                      placeholder="Add a short description residents can understand quickly."
                      value={values.description}
                      onChange={(e) => setValues({ ...values, description: e.target.value })}
                    />
                    <small>{values.description.length} characters</small>
                  </label>
                </section>

                <section className="facility-form-section">
                  <div className="facility-section-heading">
                    <span className="facility-section-icon"><Building2 size={18} /></span>
                    <div>
                      <h3>Location & media</h3>
                      <p>Choose the building and add visual information for the facility.</p>
                    </div>
                  </div>

                  <div className="facility-field-grid two">
                    {row ? (
                      <div className="facility-readonly-field">
                        <span>Building</span>
                        <strong>{first(row.data, ['buildingName', 'buildingId'], 'Unspecified')}</strong>
                        <small>Building cannot be changed while editing.</small>
                      </div>
                    ) : (
                      <label>
                        <span>Building *</span>
                        <select
                          required
                          value={buildingId}
                          disabled={buildings.loading || !!buildings.error}
                          onChange={(e) => setBuildingId(e.target.value)}
                        >
                          <option value="">
                            {buildings.loading ? 'Loading buildings…' : 'Select building'}
                          </option>
                          {buildingOptions.map((building) => (
                            <option key={building.id} value={building.id}>{building.name}</option>
                          ))}
                        </select>
                      </label>
                    )}

                    <label>
                      <span>Icon name</span>
                      <input
                        placeholder="Optional icon reference"
                        value={values.iconName}
                        onChange={(e) => setValues({ ...values, iconName: e.target.value })}
                      />
                    </label>
                  </div>

                  <div className="facility-image-manager">
                    <div className="facility-image-manager-head">
                      <div>
                        <span>Facility photos</span>
                        <small>Upload up to 6 JPG, PNG or WebP images. The first photo is used as the primary image.</small>
                      </div>
                      <span className="facility-image-limit">{gallery.length}/{FACILITY_IMAGE_LIMIT}</span>
                    </div>

                    <input
                      ref={fileInput}
                      className="sr-only"
                      id="facility-images"
                      aria-label="Facility photos"
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      multiple
                      onChange={(event) => selectImages(event.target.files)}
                    />

                    <div className="facility-image-upload-row">
                      <button
                        type="button"
                        className="facility-image-upload"
                        disabled={gallery.length >= FACILITY_IMAGE_LIMIT}
                        onClick={() => fileInput.current?.click()}
                      >
                        <ImageIcon size={18} /> Select photos
                      </button>
                      <small>Maximum 5 MB per image.</small>
                    </div>

                    {!gallery.length && legacyImageUrl && !legacyImageRemoved && (
                      <div className="facility-legacy-image">
                        <img src={legacyImageUrl} alt="Existing facility" />
                        <div>
                          <strong>Existing primary image</strong>
                          <small>This is a legacy image URL. Upload new photos to create a managed gallery.</small>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            setLegacyImageRemoved(true);
                            setGalleryTouched(true);
                          }}
                        >Remove</button>
                      </div>
                    )}

                    {!!gallery.length && (
                      <div className="facility-image-grid" aria-label="Selected facility photos">
                        {gallery.map((item, index) => (
                          <div className={`facility-image-thumb ${index === 0 ? 'primary' : ''}`} key={item.id}>
                            {item.previewUrl ? <img src={item.previewUrl} alt={`Facility photo ${index + 1}`} /> : <div className="facility-thumb-placeholder"><ImageIcon size={24} /></div>}
                            <span className="facility-thumb-number">{index + 1}</span>
                            {index === 0 && <span className="facility-primary-badge">Primary</span>}
                            <div className="facility-thumb-actions">
                              {index > 0 && (
                                <button type="button" onClick={() => makePrimary(item.id)}>Set primary</button>
                              )}
                              <button
                                type="button"
                                aria-label={`Remove facility photo ${index + 1}`}
                                onClick={() => removeGalleryItem(item.id)}
                              >
                                <Trash2 size={14} />
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {buildings.error && (
                    <p role="alert" className="form-error">
                      Unable to load buildings. {buildings.error}
                    </p>
                  )}
                  {!row && !buildings.loading && !buildings.error && !buildingOptions.length && (
                    <p role="status" className="facility-inline-warning">
                      No buildings are available. Add a building before creating a facility.
                    </p>
                  )}
                </section>

                <section className="facility-form-section facility-slot-section">
                  <div className="facility-section-heading slot-heading">
                    <span className="facility-section-icon"><CalendarClock size={18} /></span>
                    <div>
                      <h3>Booking slots</h3>
                      <p>Create slots automatically or fine-tune individual booking periods.</p>
                    </div>
                    <span className="facility-slot-count">{slots.length} slot{slots.length === 1 ? '' : 's'}</span>
                  </div>

                  <div className="slot-generator">
                    <div className="slot-generator-title">
                      <Sparkles size={17} />
                      <div>
                        <strong>Quick generate</strong>
                        <small>Build the full day schedule in one click.</small>
                      </div>
                    </div>
                    <div className="slot-generator-fields">
                      <label>
                        <span>Opens</span>
                        <input type="time" value={generatorStart} onChange={(e) => setGeneratorStart(e.target.value)} />
                      </label>
                      <label>
                        <span>Closes</span>
                        <input type="time" value={generatorEnd} onChange={(e) => setGeneratorEnd(e.target.value)} />
                      </label>
                      <label>
                        <span>Slot duration</span>
                        <select value={generatorDuration} onChange={(e) => setGeneratorDuration(e.target.value)}>
                          <option value="30">30 minutes</option>
                          <option value="45">45 minutes</option>
                          <option value="60">1 hour</option>
                          <option value="90">1.5 hours</option>
                          <option value="120">2 hours</option>
                        </select>
                      </label>
                      <button type="button" className="facility-generate-button" onClick={generateSlots}>
                        Generate slots
                      </button>
                    </div>
                  </div>

                  <div className="facility-slots-list">
                    {!slots.length ? (
                      <div className="facility-slots-empty">
                        <Clock3 size={28} />
                        <strong>No booking slots yet</strong>
                        <p>Use quick generate above, or add a custom slot manually.</p>
                        <button type="button" onClick={addEmptySlot}><Plus size={16} /> Add first slot</button>
                      </div>
                    ) : (
                      slots.map((slot, index) => (
                        <div className="facility-slot-row" key={slot.id}>
                          <span className="facility-slot-number">{index + 1}</span>
                          {slot.raw !== undefined ? (
                            <label className="facility-legacy-slot">
                              <span>Legacy slot</span>
                              <input
                                value={slot.raw}
                                onChange={(e) =>
                                  setSlots((current) =>
                                    current.map((item) =>
                                      item.id === slot.id ? { ...item, raw: e.target.value } : item,
                                    ),
                                  )
                                }
                              />
                            </label>
                          ) : (
                            <>
                              <label>
                                <span>Start</span>
                                <input
                                  type="time"
                                  required
                                  value={slot.start}
                                  onChange={(e) =>
                                    setSlots((current) =>
                                      current.map((item) =>
                                        item.id === slot.id ? { ...item, start: e.target.value } : item,
                                      ),
                                    )
                                  }
                                />
                              </label>
                              <span className="facility-slot-arrow">→</span>
                              <label>
                                <span>End</span>
                                <input
                                  type="time"
                                  required
                                  value={slot.end}
                                  onChange={(e) =>
                                    setSlots((current) =>
                                      current.map((item) =>
                                        item.id === slot.id ? { ...item, end: e.target.value } : item,
                                      ),
                                    )
                                  }
                                />
                              </label>
                              <span className="facility-slot-preview">
                                {slot.start && slot.end
                                  ? `${time24ToDisplay(slot.start)} – ${time24ToDisplay(slot.end)}`
                                  : 'Incomplete'}
                              </span>
                            </>
                          )}
                          <button
                            type="button"
                            className="facility-slot-remove"
                            aria-label={`Remove time slot ${index + 1}`}
                            onClick={() => setSlots((current) => current.filter((item) => item.id !== slot.id))}
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                      ))
                    )}
                  </div>

                  {!!slots.length && (
                    <button type="button" className="facility-add-slot" onClick={addEmptySlot}>
                      <Plus size={16} /> Add custom slot
                    </button>
                  )}
                </section>

                <section className="facility-form-section">
                  <div className="facility-section-heading">
                    <span className="facility-section-icon"><CircleDollarSign size={18} /></span>
                    <div>
                      <h3>Pricing & availability</h3>
                      <p>Make the cost clear before residents request a booking.</p>
                    </div>
                  </div>

                  <div className="facility-choice-grid two">
                    <button
                      type="button"
                      className={`facility-choice-card ${values.pricingMode === 'free' ? 'selected' : ''}`}
                      onClick={() => setValues({ ...values, pricingMode: 'free', isFree: true })}
                    >
                      <span className="facility-choice-check"><Check size={15} /></span>
                      <strong>Free facility</strong>
                      <small>No booking fee is charged.</small>
                    </button>
                    <button
                      type="button"
                      className={`facility-choice-card ${values.pricingMode !== 'free' ? 'selected' : ''}`}
                      onClick={() =>
                        setValues({
                          ...values,
                          pricingMode: values.pricingMode === 'resident_type' ? 'resident_type' : 'flat',
                          isFree: false,
                        })
                      }
                    >
                      <span className="facility-choice-check"><Check size={15} /></span>
                      <strong>Paid facility</strong>
                      <small>Residents must pay a booking fee.</small>
                    </button>
                  </div>

                  {values.pricingMode !== 'free' && (
                    <div className="facility-pricing-panel">
                      <span className="facility-pricing-label">Pricing method</span>
                      <div className="facility-segmented-control">
                        <button
                          type="button"
                          className={values.pricingMode === 'flat' ? 'active' : ''}
                          onClick={() => setValues({ ...values, pricingMode: 'flat', isFree: false })}
                        >
                          Same fee for everyone
                        </button>
                        <button
                          type="button"
                          className={values.pricingMode === 'resident_type' ? 'active' : ''}
                          onClick={() =>
                            setValues({ ...values, pricingMode: 'resident_type', isFree: false })
                          }
                        >
                          Fee by resident type
                        </button>
                      </div>

                      {values.pricingMode === 'flat' && (
                        <label className="facility-money-field">
                          <span>Fee per day *</span>
                          <div><b>₱</b><input type="number" min="0" step="any" required value={values.price} onChange={(e) => setValues({ ...values, price: e.target.value })} /></div>
                        </label>
                      )}

                      {values.pricingMode === 'resident_type' && (
                        <div className="facility-field-grid two">
                          <label className="facility-money-field">
                            <span>Owner fee per day *</span>
                            <div><b>₱</b><input type="number" min="0" step="any" required value={values.ownerPrice} onChange={(e) => setValues({ ...values, ownerPrice: e.target.value })} /></div>
                          </label>
                          <label className="facility-money-field">
                            <span>Tenant / Lease fee per day *</span>
                            <div><b>₱</b><input type="number" min="0" step="any" required value={values.tenantPrice} onChange={(e) => setValues({ ...values, tenantPrice: e.target.value })} /></div>
                          </label>
                        </div>
                      )}
                    </div>
                  )}

                  <div className="facility-availability-control">
                    <div>
                      <strong>Facility availability</strong>
                      <small>Inactive facilities remain in the admin list but cannot be booked.</small>
                    </div>
                    <div className="facility-status-toggle" role="group" aria-label="Facility availability">
                      <button
                        type="button"
                        className={values.isAvailable ? 'active' : ''}
                        onClick={() => setValues({ ...values, isAvailable: true })}
                      >Active</button>
                      <button
                        type="button"
                        className={!values.isAvailable ? 'inactive active' : ''}
                        onClick={() => setValues({ ...values, isAvailable: false })}
                      >Inactive</button>
                    </div>
                  </div>
                </section>
              </div>

              <aside className="facility-form-preview">
                <div className="facility-preview-sticky">
                  <span className="facility-preview-label">LIVE PREVIEW</span>
                  <div className="facility-preview-card">
                    <div className="facility-preview-image">
                      {primaryPreview ? (
                        <img src={primaryPreview} alt="" />
                      ) : (
                        <div><ImageIcon size={31} /><span>Facility image</span></div>
                      )}
                      {gallery.length > 1 && <span className="facility-preview-count">1 / {gallery.length}</span>}
                      <span className={`facility-preview-status ${values.isAvailable ? 'active' : 'inactive'}`}>
                        {values.isAvailable ? 'Active' : 'Inactive'}
                      </span>
                    </div>
                    <div className="facility-preview-body">
                      <small>{values.type || 'Facility type'}</small>
                      <h3>{values.name.trim() || 'Facility name'}</h3>
                      <p>{values.description.trim() || 'Your facility description will appear here.'}</p>

                      <dl>
                        <div><dt>Building</dt><dd>{row ? first(row.data, ['buildingName', 'buildingId'], 'Unspecified') : buildingOptions.find((item) => item.id === buildingId)?.name || 'Not selected'}</dd></div>
                        <div><dt>Booking slots</dt><dd>{slots.length ? `${slots.length} configured` : 'No slots'}</dd></div>
                        <div><dt>Fee</dt><dd className={values.pricingMode === 'free' ? 'free' : 'paid'}>{previewPrice}</dd></div>
                      </dl>
                    </div>
                  </div>
                  <div className="facility-preview-tip">
                    <Info size={16} />
                    Residents should be able to understand the facility, booking schedule and price without opening extra screens.
                  </div>
                </div>
              </aside>
            </div>

            {error && <p role="alert" className="form-error facility-form-error">{error}</p>}

            <div className="facility-form-footer">
              <button type="button" onClick={close}>Cancel</button>
              <button
                className="primary"
                type="submit"
                disabled={!row && (buildings.loading || !!buildings.error || !buildingOptions.length)}
              >
                {busy ? 'Saving…' : row ? 'Save changes' : 'Create facility'}
              </button>
            </div>
          </fieldset>
        </form>
      </Modal>
    </div>
  );
}

export function FacilityActions({
  s,
  row,
  onEdit,
  onSaved,
}: {
  s: Session;
  row: Row;
  onEdit: () => void;
  onSaved: () => void;
}) {
  const saving = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function toggle() {
    if (saving.current) return;
    saving.current = true;
    setBusy(true);
    setError('');
    try {
      await setFacilityAvailability(s, row.id, row.data.isAvailable !== true);
      if (mounted.current) onSaved();
    } catch (error) {
      setError(
        error instanceof Error ? error.message : 'Unable to change availability. Please try again.',
      );
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }

  return (
    <div className="detail-actions" aria-busy={busy}>
      <fieldset disabled={busy}>
        <div className="button-row">
          <button className="primary" onClick={onEdit}>Edit facility</button>
          <button onClick={() => void toggle()}>
            {busy
              ? 'Saving…'
              : row.data.isAvailable === true
                ? 'Deactivate facility'
                : 'Activate facility'}
          </button>
        </div>
      </fieldset>
      {error && <p role="alert" className="form-error">{error}</p>}
    </div>
  );
}
