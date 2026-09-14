import {
  addDoc,
  collection,
  doc,
  getDocFromServer,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
} from 'firebase/firestore';
import { getBlob, ref, uploadBytes } from 'firebase/storage';
import { call, firebase } from './firebase';
import {
  type CreateFacilityInput,
  type Data,
  type FacilityPricingMode,
  first,
  type Session,
  str,
  type UpdateFacilityInput,
} from './models';
import { assertResident, assertScope, parseCommunity, parseProfile } from './policy';
export async function currentAuthority(s: Session) {
  const f = firebase();
  const user = f.auth.currentUser;
  if (!user || user.uid !== s.uid) throw Error('Sign in again to continue.');
  const token = await user.getIdTokenResult();
  if (token.signInProvider !== 'phone') throw Error('Phone verification is required.');
  const profileDoc = await getDocFromServer(
    doc(f.db, s.role === 'resident' ? 'users' : 'admins', s.uid),
  );
  const profile = parseProfile(
    s.uid,
    profileDoc.data() || {},
    s.role === 'resident' ? 'resident' : 'admin',
    user.phoneNumber || '',
  );
  const id = assertScope(s);
  const c = await getDocFromServer(doc(f.db, 'communities', id));
  const community = parseCommunity(id, c.data() || {});
  if (s.role === 'resident') {
    assertResident(profile, community);
    if (profile.flatId !== s.profile.flatId)
      throw Error('Your unit assignment changed. Sign in again.');
  }
  if (s.role === 'admin' && !profile.authorizedCommunityIds.includes(id))
    throw Error('Community access revoked.');
  return { ...s, profile, community };
}
function required(v: string, label: string) {
  if (!v.trim()) throw Error(label + ' is required.');
  return v.trim();
}
function facilityId(value: unknown, label: string) {
  const id = str(value);
  if (!id || id.includes('/') || /^\.{1,2}$/.test(id) || /^__.*__$/.test(id))
    throw Error(label + ' must be a valid document ID.');
  return id;
}
function facilityString(value: unknown, label: string, isRequired = false) {
  if (typeof value !== 'string') throw Error(label + ' must be a string.');
  return isRequired ? required(value, label) : value.trim();
}
function facilityBoolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') throw Error(label + ' must be a boolean.');
  return value;
}
function facilityPrice(value: unknown, label = 'Price per day'): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0)
    throw Error(`${label} must be a finite number greater than or equal to 0.`);
  return value;
}

function facilityPricingMode(value: unknown): FacilityPricingMode {
  if (value !== 'free' && value !== 'flat' && value !== 'resident_type')
    throw Error('Pricing mode must be free, flat, or resident_type.');
  return value;
}
const facilityEditableFields = [
  'name',
  'type',
  'description',
  'iconName',
  'imageUrl',
  'timeSlots',
  'isAvailable',
  'isFree',
  'pricingMode',
  'pricePerDay',
  'ownerPricePerDay',
  'tenantPricePerDay',
] as const satisfies readonly (keyof UpdateFacilityInput)[];

function facilityFields(values: UpdateFacilityInput): Data {
  if (!values || typeof values !== 'object' || Array.isArray(values))
    throw Error('Facility values must be an object.');
  const fields: Data = {};
  // Project explicitly: never spread caller input into a Firestore write.
  for (const key of facilityEditableFields) {
    if (!Object.hasOwn(values, key)) continue;
    const value = values[key];
    if (key === 'isFree' || key === 'isAvailable') {
      fields[key] = facilityBoolean(value, key);
    } else if (key === 'pricingMode') {
      fields[key] = facilityPricingMode(value);
    } else if (
      key === 'pricePerDay' ||
      key === 'ownerPricePerDay' ||
      key === 'tenantPricePerDay'
    ) {
      const label =
        key === 'ownerPricePerDay'
          ? 'Owner price per day'
          : key === 'tenantPricePerDay'
            ? 'Tenant price per day'
            : 'Price per day';

      fields[key] = facilityPrice(value, label);
    } else if (key === 'timeSlots') {
      if (!Array.isArray(value)) throw Error('Time slots must be an array of nonempty strings.');
      fields[key] = Array.from(value, (slot) => facilityString(slot, 'Time slot', true));
    } else {
      const text = facilityString(value, key, key === 'name' || key === 'type');
      if (key === 'imageUrl' && text) {
        let url: URL;
        try {
          url = new URL(text);
        } catch {
          throw Error('Image URL must be an http:// or https:// URL.');
        }
        if (
          !/^https?:\/\//i.test(text) ||
          !['http:', 'https:'].includes(url.protocol) ||
          !url.hostname
        )
          throw Error('Image URL must be an http:// or https:// URL.');
      }
      fields[key] = text;
    }
  }
  return fields;
}

/** Creates an amenity in the revalidated administrator's selected community. */
export async function createFacility(session: Session, values: CreateFacilityInput) {
  const s = await currentAuthority(session);
  if (s.role !== 'admin' || s.profile.role !== 'admin')
    throw Error('An administrator is required.');
  const fields = facilityFields(values);
  fields.name = facilityString(fields.name, 'Name', true);
  fields.type = facilityString(fields.type, 'Type', true);
  fields.isAvailable = facilityBoolean(fields.isAvailable, 'isAvailable');
  fields.isFree = facilityBoolean(fields.isFree, 'isFree');

  const pricingMode = Object.hasOwn(fields, 'pricingMode')
    ? facilityPricingMode(fields.pricingMode)
    : fields.isFree
      ? 'free'
      : 'flat';

  if (pricingMode === 'free') {
    if (fields.isFree !== true)
      throw Error('Free pricing requires the facility to be marked free.');

    fields.pricingMode = 'free';
    fields.isFree = true;
    fields.pricePerDay = 0;
  } else if (pricingMode === 'flat') {
    if (fields.isFree !== false)
      throw Error('Flat pricing requires the facility to be chargeable.');

    fields.pricingMode = 'flat';
    fields.isFree = false;
    fields.pricePerDay = facilityPrice(fields.pricePerDay);
  } else {
    if (fields.isFree !== false)
      throw Error('Resident-type pricing requires the facility to be chargeable.');

    fields.pricingMode = 'resident_type';
    fields.isFree = false;
    fields.pricePerDay = 0;
    fields.ownerPricePerDay = facilityPrice(
      fields.ownerPricePerDay,
      'Owner price per day',
    );
    fields.tenantPricePerDay = facilityPrice(
      fields.tenantPricePerDay,
      'Tenant price per day',
    );
  }

  fields.timeSlots ??= [];
  const buildingId = facilityId(values.buildingId, 'Building ID');
  const building = (await getDocFromServer(doc(firebase().db, 'buildings', buildingId))).data();
  if (!building) throw Error('Building does not exist.');
  if (building.communityId !== s.community.id) throw Error('Building is outside your community.');
  return addDoc(collection(firebase().db, 'amenities'), {
    ...fields,
    buildingId,
    buildingName: first(building, ['buildingName', 'name'], buildingId),
    communityId: s.community.id,
    adminId: s.uid,
    authorId: s.uid,
    authorName: s.profile.name,
    maxCapacity: 1,
    allowMultipleBookings: false,
    bookingDurations: ['1 hour'],
    hasSubscriptionPackages: false,
    subscriptionPackages: {},
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

async function facilityTarget(session: Session, amenityId: string) {
  const s = await currentAuthority(session);
  if (s.role !== 'admin' || s.profile.role !== 'admin')
    throw Error('An administrator is required.');
  const record = doc(firebase().db, 'amenities', facilityId(amenityId, 'Facility ID'));
  const data = (await getDocFromServer(record)).data();
  if (!data) throw Error('Facility does not exist.');
  if (data.communityId !== s.community.id) throw Error('Facility is outside your community.');
  return { record, data };
}

/** Partial V1 edits; unknown input fields are rejected and stored legacy fields are preserved. */
export async function updateFacility(
  session: Session,
  amenityId: string,
  values: UpdateFacilityInput,
) {
  const { record, data } = await facilityTarget(session, amenityId);
  const fields = facilityFields(values);
  for (const key of Object.keys(values)) {
    if (!facilityEditableFields.some((field) => field === key))
      throw Error('Facility field is not editable: ' + key);
  }
  // Validate existing pricing only when pricing is edited, so unrelated legacy edits still work.
  // Validate pricing only when a pricing field is edited.
  // Unrelated edits to historical facilities remain compatible.
  const pricingEdited = [
    'isFree',
    'pricingMode',
    'pricePerDay',
    'ownerPricePerDay',
    'tenantPricePerDay',
  ].some((key) => Object.hasOwn(fields, key));

  if (pricingEdited) {
    const existingMode: FacilityPricingMode =
      data.pricingMode === 'free' ||
        data.pricingMode === 'flat' ||
        data.pricingMode === 'resident_type'
        ? data.pricingMode
        : data.isFree === true
          ? 'free'
          : 'flat';

    let pricingMode: FacilityPricingMode = Object.hasOwn(fields, 'pricingMode')
      ? facilityPricingMode(fields.pricingMode)
      : existingMode;

    // Backward compatibility with older clients which only changed isFree.
    if (!Object.hasOwn(fields, 'pricingMode') && Object.hasOwn(fields, 'isFree')) {
      const requestedIsFree = facilityBoolean(fields.isFree, 'isFree');

      if (requestedIsFree) {
        pricingMode = 'free';
      } else if (existingMode === 'free') {
        pricingMode = 'flat';
      }
    }

    const expectedIsFree = pricingMode === 'free';

    if (Object.hasOwn(fields, 'isFree')) {
      const requestedIsFree = facilityBoolean(fields.isFree, 'isFree');

      if (requestedIsFree !== expectedIsFree)
        throw Error('Facility pricing mode does not match its free/chargeable setting.');
    }

    fields.pricingMode = pricingMode;
    fields.isFree = expectedIsFree;

    if (pricingMode === 'free') {
      fields.pricePerDay = 0;
    } else if (pricingMode === 'flat') {
      fields.pricePerDay = facilityPrice(
        Object.hasOwn(fields, 'pricePerDay') ? fields.pricePerDay : data.pricePerDay,
      );
    } else {
      fields.pricePerDay = 0;

      fields.ownerPricePerDay = facilityPrice(
        Object.hasOwn(fields, 'ownerPricePerDay')
          ? fields.ownerPricePerDay
          : data.ownerPricePerDay,
        'Owner price per day',
      );

      fields.tenantPricePerDay = facilityPrice(
        Object.hasOwn(fields, 'tenantPricePerDay')
          ? fields.tenantPricePerDay
          : data.tenantPricePerDay,
        'Tenant price per day',
      );
    }
  }
  await updateDoc(record, { ...fields, updatedAt: serverTimestamp() });
}

/** Availability changes deliberately write only the flag and its server timestamp. */
export async function setFacilityAvailability(
  session: Session,
  amenityId: string,
  isAvailable: boolean,
) {
  const { record } = await facilityTarget(session, amenityId);
  await updateDoc(record, {
    isAvailable: facilityBoolean(isAvailable, 'isAvailable'),
    updatedAt: serverTimestamp(),
  });
}
export async function createComplaint(session: Session, values: Record<string, string>) {
  const s = await currentAuthority(session);
  if (s.role !== 'resident') throw Error('A resident account is required.');
  const p = s.profile;
  return addDoc(collection(firebase().db, 'complaints'), {
    userId: s.uid,
    residentId: s.uid,
    userName: p.name,
    userEmail: str(p.data.email),
    flatId: p.flatId,
    flatLabel: p.flatLabel,
    adminId: p.data.adminId ?? null,
    communityId: s.community.id,
    title: required(values.title, 'Title'),
    description: required(values.description, 'Description'),
    category: required(values.category, 'Category').toLowerCase(),
    status: 'pending',
    assignedTo: null,
    technicianPhone: null,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}
export async function createVisitor(session: Session, v: Record<string, string>) {
  const s = await currentAuthority(session);
  if (s.role !== 'resident') throw Error('A resident account is required.');
  const p = s.profile;
  const arrival = new Date(v.expectedArrival);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (!Number.isFinite(arrival.getTime()) || arrival < today)
    throw Error('Choose a valid arrival date from today onwards.');
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  const pass = Array.from(bytes, (x) => alphabet[x % 32]).join('');
  const token = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(24))))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '');
  return addDoc(collection(firebase().db, 'visitors'), {
    hostUserId: s.uid,
    hostName: p.name,
    hostEmail: str(p.data.email),
    flatId: p.flatId,
    flatLabel: p.flatLabel,
    adminId: p.data.adminId ?? null,
    communityId: s.community.id,
    visitorName: required(v.visitorName, 'Visitor name'),
    purpose: required(v.purpose, 'Purpose'),
    expectedArrival: Timestamp.fromDate(arrival),
    phoneNumber: v.phoneNumber?.trim() || null,
    vehicleNumber: v.vehicleNumber?.trim() || null,
    visitorPassCode: pass.slice(0, 4) + '-' + pass.slice(4),
    qrToken: token,
    status: 'expected',
    isApproved: false,
    approvedBy: null,
    approvedAt: null,
    actualArrival: null,
    departure: null,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}
export async function updateScoped(
  session: Session,
  collectionName: 'complaints' | 'visitors' | 'notices' | 'notifications',
  id: string,
  fields: Data,
) {
  const s = await currentAuthority(session);
  const record = doc(firebase().db, collectionName, id);
  const data = (await getDocFromServer(record)).data();
  if (data?.communityId !== s.community.id) throw Error('Record is outside your community.');
  if (collectionName === 'notifications') {
    if (data.recipientId !== s.uid) throw Error('Notification access denied.');
    await updateDoc(record, {
      isRead: true,
      readAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return;
  }
  if (s.role !== 'admin') throw Error('An administrator is required.');
  await updateDoc(record, { ...fields, updatedAt: serverTimestamp() });
}
export async function publishNotice(session: Session, v: Record<string, string>) {
  const s = await currentAuthority(session);
  if (s.role !== 'admin') throw Error('An administrator is required.');
  await addDoc(collection(firebase().db, 'notices'), {
    communityId: s.community.id,
    title: required(v.title, 'Title'),
    content: required(v.content, 'Content'),
    targetFlats: [],
    isActive: true,
    status: 'published',
    adminId: s.uid,
    authorId: s.uid,
    authorName: s.profile.name,
    createdAt: serverTimestamp(),
    publishedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}
export async function residentLifecycle(
  session: Session,
  userId: string,
  action: 'deactivateResident' | 'reactivateResident' | 'rejectResidentRegistration',
  reason?: string,
) {
  const s = await currentAuthority(session);
  if (s.role !== 'admin') throw Error('An administrator is required.');
  return call(action, { communityId: s.community.id, userId, ...(reason ? { reason } : {}) });
}
export async function submitProof(session: Session, billId: string, file: File) {
  const s = await currentAuthority(session);
  if (s.role !== 'resident') throw Error('A resident account is required.');
  const ext = file.name.split('.').pop()?.toLowerCase() || '';
  const types: Record<string, string> = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    heic: 'image/heic',
    heif: 'image/heif',
  };
  if (!types[ext] || file.size <= 0 || file.size >= 10 * 1024 * 1024)
    throw Error('Choose a JPG, PNG, HEIC or HEIF image smaller than 10 MB.');
  const bill = (await getDocFromServer(doc(firebase().db, 'bills', billId))).data();
  if (
    !bill ||
    bill.communityId !== s.community.id ||
    bill.flatId !== s.profile.flatId ||
    bill.status !== 'pending' ||
    typeof bill.amount !== 'number' ||
    bill.amount <= 0
  )
    throw Error('This bill is not eligible for payment proof.');
  const existing = await getDocs(
    query(
      collection(firebase().db, 'payments'),
      where('communityId', '==', s.community.id),
      where('flatId', '==', s.profile.flatId),
      where('billId', '==', billId),
      where('userId', '==', s.uid),
    ),
  );
  if (existing.docs.some((d) => d.data().status === 'pending'))
    throw Error('A proof is already pending review.');
  const payment = doc(collection(firebase().db, 'payments'));
  const path = `payment_receipts/${s.community.id}/${billId}/${s.uid}/${payment.id}.${ext}`;
  await uploadBytes(ref(firebase().storage, path), file, {
    contentType: types[ext],
    customMetadata: {
      paymentId: payment.id,
      billId,
      communityId: s.community.id,
      residentUid: s.uid,
    },
  });
  try {
    await setDoc(payment, {
      id: payment.id,
      communityId: s.community.id,
      billId,
      flatId: s.profile.flatId,
      userId: s.uid,
      amount: bill.amount,
      method: 'external',
      status: 'pending',
      transactionId: null,
      receiptPath: path,
      paymentDate: Timestamp.now(),
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    });
  } catch {
    throw Error(
      'The receipt uploaded, but the payment submission failed. Contact management with reference ' +
      payment.id +
      ' before retrying.',
    );
  }
}
export async function receiptBlob(session: Session, path: string) {
  const s = await currentAuthority(session);
  if (!path.startsWith('payment_receipts/' + s.community.id + '/'))
    throw Error('Receipt is outside your community.');
  return getBlob(ref(firebase().storage, path), 10 * 1024 * 1024);
}
