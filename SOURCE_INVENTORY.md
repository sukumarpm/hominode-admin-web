# Source contract inventory

Inspected before implementing React data logic. Source working tree is authoritative, including uncommitted changes. No Flutter/backend files were edited.

## Routes and module scope
Admin Flutter web: dashboard, community, buildings/units, residents/bulk import, visitors, complaints, amenities, billing/payment review, events/notices, reports, settings. Admin desktop also exposes parking, resident vehicles and profile. Platform super-admin: communities, admins, platform overview.
Resident Flutter web: dashboard, unit, bills/payment proof, visitors, complaints, notices and events. Mobile adds amenities/bookings, family/vehicles, community wall, chats, documents, marketplace, staff, profile/settings, identity/onboarding and SOS. These are inventoried even where this web migration does not yet implement an interaction.

## Security findings
- Phone OTP is the canonical authentication provider. Admin profile uid/phone must match the authenticated user; role and isActive must be valid. Ordinary admins require authorizedCommunityIds and an active selected community. Super-admin only accesses the platform registry.
- Resident uses canonical users/{auth.uid}, approved + active, status absent or active, active community, unambiguous owner/tenant classification, tenant identity verified (and owner identity if community requires it). Resident URL must match resolveResidentCommunity result and assigned community. No legacy authUid fallback.
- Firestore rules deny resident notice list queries. getResidentNoticeIds callable is the canonical discovery API, but its APP_CONTEXTS check currently recognizes only mobile resident app IDs. React must report an unavailable state, not scan notices.
- Notification registration/removal also requires a mobile APP_CONTEXTS entry. Web FCM registration cannot be made functional without an authorized backend change; no app-ID spoofing or alternate write is allowed.
- SOS is server-owned: getSosContext, triggerSos, transitionSos; no client writes to sosAlerts. Active statuses: triggered/acknowledged/responding.
- requests in listing_firestore_service.dart are marketplace requests, not an independent service-ticket schema. Service Requests web navigation uses the existing complaints workflow.

## Hosting
- Project hominode-prod; Functions asia-southeast1; shared existing web app ID 1:551984029668:web:5845083359a375d90db1f1; reCAPTCHA Enterprise site key reused from hominode_web/lib/main.dart.
- hominode_app => hominode-app-prod (firebase.admin.json Admin target); hominode_prod => hominode-prod (root/resident). Domain bindings are not proven by local config; verify in console before a future deployment.

## Source index: literal collections, callables and route paths

### hominode_web/lib/src/pages/admin_amenities_page.dart
Collections: `amenities`

### hominode_web/lib/src/pages/admin_billing_page.dart
Collections: `bills`

### hominode_web/lib/src/pages/admin_buildings_page.dart
Collections: `buildings`, `flats`

### hominode_web/lib/src/pages/admin_complaints_page.dart
Collections: `complaints`

### hominode_web/lib/src/pages/admin_events_notices_page.dart
Collections: `events`, `notices`

### hominode_web/lib/src/pages/admin_reports_page.dart
Collections: `amenities`, `bills`, `buildings`, `complaints`, `events`, `notices`, `users`, `visitors`

### hominode_web/lib/src/pages/admin_residents_page.dart
Collections: `users`

### hominode_web/lib/src/pages/admin_visitors_page.dart
Collections: `visitors`

### hominode_web/lib/src/pages/role_homes.dart
Routes: `/admin`, `/admin/amenities`, `/admin/billing`, `/admin/buildings`, `/admin/community`, `/admin/complaints`, `/admin/events`, `/admin/reports`, `/admin/residents`, `/admin/settings`, `/admin/visitors`, `/resident`, `/resident/bills`, `/resident/complaints`, `/resident/events`, `/resident/notices`, `/resident/unit`, `/resident/visitors`, `/super-admin`, `/super-admin/admins`, `/super-admin/communities`, `/super-admin/platform-overview`

### hominode_web/lib/src/pages/super_admin_admins_page.dart
Collections: `admins`, `communities`

### hominode_web/lib/src/pages/super_admin_communities_page.dart
Collections: `communities`

### hominode_web/lib/src/pages/super_admin_platform_overview_page.dart
Collections: `admins`, `communities`

### hominode_web/lib/src/services/admin_payment_review_service.dart
Collections: `payments`
Callables: `rejectPaymentProof`, `verifyPaymentProof`

### hominode_web/lib/src/services/dashboard_repository.dart
Collections: `admins`, `communities`

### hominode_web/lib/src/services/resident_bulk_import_service.dart
Callables: `importResidentsBulk`, `validateResidentBulkImport`

### hominode_web/lib/src/services/resident_complaint_service.dart
Collections: `users`

### hominode_web/lib/src/services/resident_payment_service.dart
Collections: `bills`, `payments`

### hominode_web/lib/src/services/resident_visitor_service.dart
Collections: `users`

### hominode_web/lib/src/services/super_admin_service.dart
Callables: `createAdmin`, `createCommunity`, `setAdminActive`, `setCommunityActive`, `updateAdminAssignments`, `updateCommunity`

### hominode_web/lib/src/tenant/web_host.dart
Callables: `resolveResidentCommunity`

### hominode-admin/admin_app/lib/.dart_backups/admin_app/lib/admin_dashboard_page.dart
Collections: `admins`, `notifications`

### hominode-admin/admin_app/lib/.dart_backups/admin_app/lib/complaint_management_screen.dart
Collections: `flats`, `users`

### hominode-admin/admin_app/lib/.dart_backups/admin_app/lib/debug_admin_helper.dart
Collections: `admins`

### hominode-admin/admin_app/lib/.dart_backups/admin_app/lib/profile_screen.dart
Collections: `users`

### hominode-admin/admin_app/lib/.dart_backups/admin_app/lib/resident_vehicle_registration_screen.dart
Collections: `users`

### hominode-admin/admin_app/lib/.dart_backups/admin_app/lib/services/access_control_service.dart
Collections: `buildings`, `flats`, `users`

### hominode-admin/admin_app/lib/.dart_backups/admin_app/lib/services/admin_service.dart
Collections: `buildings`, `flats`, `users`

### hominode-admin/admin_app/lib/.dart_backups/admin_app/lib/services/auth_service.dart
Collections: `admins`

### hominode-admin/admin_app/lib/.dart_backups/admin_app/lib/services/billing_service.dart
Collections: `users`

### hominode-admin/admin_app/lib/.dart_backups/admin_app/lib/services/broadcast_service.dart
Collections: `broadcasts`, `users`

### hominode-admin/admin_app/lib/.dart_backups/admin_app/lib/services/building_service.dart
Collections: `admins`, `flats`, `users`

### hominode-admin/admin_app/lib/.dart_backups/admin_app/lib/services/chat_service.dart
Collections: `users`

### hominode-admin/admin_app/lib/.dart_backups/admin_app/lib/services/community_invite_service.dart
Collections: `communities`
Callables: `createCommunity`, `createCommunityInvite`, `listCommunityInvites`, `revokeCommunityInvite`

### hominode-admin/admin_app/lib/.dart_backups/admin_app/lib/services/complaint_service.dart
Collections: `notifications`

### hominode-admin/admin_app/lib/.dart_backups/admin_app/lib/services/dashboard_service.dart
Collections: `bills`, `complaints`, `flats`, `users`, `visitors`

### hominode-admin/admin_app/lib/.dart_backups/admin_app/lib/services/data_storage_diagnostic.dart
Collections: `admins`, `flats`, `users`

### hominode-admin/admin_app/lib/.dart_backups/admin_app/lib/services/firestore_test_service.dart
Collections: `_test`, `users`

### hominode-admin/admin_app/lib/.dart_backups/admin_app/lib/services/flat_service.dart
Collections: `admins`

### hominode-admin/admin_app/lib/.dart_backups/admin_app/lib/services/gate_service.dart
Collections: `gates`

### hominode-admin/admin_app/lib/.dart_backups/admin_app/lib/services/notice_service.dart
Collections: `flats`

### hominode-admin/admin_app/lib/.dart_backups/admin_app/lib/services/notification_service.dart
Collections: `notifications`

### hominode-admin/admin_app/lib/.dart_backups/admin_app/lib/services/parking_service.dart
Collections: `users`

### hominode-admin/admin_app/lib/.dart_backups/admin_app/lib/services/reports_service.dart
Collections: `bills`, `buildings`, `complaints`, `flats`, `parcels`

### hominode-admin/admin_app/lib/.dart_backups/admin_app/lib/services/resident_deletion_service.dart
Collections: `amenity_bookings`, `complaints`, `flats`, `messages`, `notifications`, `users`, `visitors`

### hominode-admin/admin_app/lib/.dart_backups/admin_app/lib/services/resident_service.dart
Collections: `buildings`, `flats`

### hominode-admin/admin_app/lib/.dart_backups/admin_app/lib/services/staff_qr_service.dart
Collections: `staff`, `staffAttendance`

### hominode-admin/admin_app/lib/.dart_backups/admin_app/lib/services/user_service.dart
Collections: `flats`

### hominode-admin/admin_app/lib/.dart_backups/admin_app/lib/services/visitor_service.dart
Collections: `buildings`

### hominode-admin/admin_app/lib/.dart_backups/admin_app/lib/widgets/create_monthly_bill_modal.dart
Collections: `buildings`, `flats`, `users`

### hominode-admin/admin_app/lib/.dart_backups/admin_app/lib/widgets/edit_profile_modal.dart
Collections: `admins`

### hominode-admin/admin_app/lib/.dart_backups/resident_app/lib/check_amenities_now.dart
Collections: `amenities`, `users`

### hominode-admin/admin_app/lib/.dart_backups/resident_app/lib/check_user_exists.dart
Collections: `users`

### hominode-admin/admin_app/lib/.dart_backups/resident_app/lib/create_auth_user_now.dart
Collections: `users`

### hominode-admin/admin_app/lib/.dart_backups/resident_app/lib/create_firebase_user.dart
Collections: `users`

### hominode-admin/admin_app/lib/.dart_backups/resident_app/lib/create_test_billing_data.dart
Collections: `bills`, `flats`

### hominode-admin/admin_app/lib/.dart_backups/resident_app/lib/dashboard_screen.dart
Collections: `users`

### hominode-admin/admin_app/lib/.dart_backups/resident_app/lib/diagnose_billing_flow.dart
Collections: `bills`

### hominode-admin/admin_app/lib/.dart_backups/resident_app/lib/diagnose_billing_now.dart
Collections: `bills`, `users`

### hominode-admin/admin_app/lib/.dart_backups/resident_app/lib/diagnose_chat_requests_now.dart
Collections: `chatRequests`, `users`

### hominode-admin/admin_app/lib/.dart_backups/resident_app/lib/diagnose_firestore_permission.dart
Collections: `bills`, `complaints`, `users`, `visitors`

### hominode-admin/admin_app/lib/.dart_backups/resident_app/lib/diagnose_flat_members.dart
Collections: `flats`, `users`

### hominode-admin/admin_app/lib/.dart_backups/resident_app/lib/diagnose_messages_complete.dart
Collections: `chatRequests`, `chats`, `users`

### hominode-admin/admin_app/lib/.dart_backups/resident_app/lib/diagnose_messages_members.dart
Collections: `users`

### hominode-admin/admin_app/lib/.dart_backups/resident_app/lib/diagnose_messages_now.dart
Collections: `chatRequests`, `chats`, `flats`, `users`

### hominode-admin/admin_app/lib/.dart_backups/resident_app/lib/fix_firestore_permissions_complete.dart
Collections: `bills`, `complaints`, `users`, `visitors`

### hominode-admin/admin_app/lib/.dart_backups/resident_app/lib/fix_login_issue.dart
Collections: `users`

### hominode-admin/admin_app/lib/.dart_backups/resident_app/lib/main.dart
Routes: `/awaiting-approval`, `/home`, `/login`, `/resident-access-blocked`, `/resident-registration`, `/splash`

### hominode-admin/admin_app/lib/.dart_backups/resident_app/lib/main_localized.dart
Routes: `/awaiting-approval`, `/home`, `/login`, `/onboarding`, `/resident-access-blocked`, `/resident-registration`, `/splash`

### hominode-admin/admin_app/lib/.dart_backups/resident_app/lib/profile_screen.dart
Collections: `users`

### hominode-admin/admin_app/lib/.dart_backups/resident_app/lib/src/modals/complaint_detail_modal.dart
Collections: `complaints`

### hominode-admin/admin_app/lib/.dart_backups/resident_app/lib/src/screens/documents_circulars_screen.dart
Collections: `documents`

### hominode-admin/admin_app/lib/.dart_backups/resident_app/lib/src/screens/domestic_staff_screen.dart
Collections: `domesticStaff`

### hominode-admin/admin_app/lib/.dart_backups/resident_app/lib/src/screens/edit_profile_screen.dart
Collections: `users`

### hominode-admin/admin_app/lib/.dart_backups/resident_app/lib/src/screens/marketplace_screen.dart
Routes: `/marketplace_buyer_phone_view`, `/marketplace_edit_listing`, `/marketplace_your_product_detail`

### hominode-admin/admin_app/lib/.dart_backups/resident_app/lib/src/screens/marketplace_screen_enhanced.dart
Routes: `/marketplace_edit_listing`, `/marketplace_your_product_detail`

### hominode-admin/admin_app/lib/.dart_backups/resident_app/lib/src/screens/my_bookings_screen.dart
Collections: `amenityBookings`

### hominode-admin/admin_app/lib/.dart_backups/resident_app/lib/src/services/admin_chat_service.dart
Collections: `flats`

### hominode-admin/admin_app/lib/.dart_backups/resident_app/lib/src/services/admin_data_service.dart
Collections: `buildings`, `complaints`, `users`, `visitors`

### hominode-admin/admin_app/lib/.dart_backups/resident_app/lib/src/services/admin_login_service.dart
Collections: `users`

### hominode-admin/admin_app/lib/.dart_backups/resident_app/lib/src/services/admin_statistics_service.dart
Collections: `bills`, `complaints`, `flats`, `users`, `visitors`

### hominode-admin/admin_app/lib/.dart_backups/resident_app/lib/src/services/amenities_booking_flow_function.dart
Collections: `amenities`, `bookings`, `users`

### hominode-admin/admin_app/lib/.dart_backups/resident_app/lib/src/services/amenities_booking_logic.dart
Collections: `amenityBookings`

### hominode-admin/admin_app/lib/.dart_backups/resident_app/lib/src/services/announcements_events_service.dart
Collections: `announcements`, `events`

### hominode-admin/admin_app/lib/.dart_backups/resident_app/lib/src/services/apartment_images_service.dart
Collections: `apartmentImages`

### hominode-admin/admin_app/lib/.dart_backups/resident_app/lib/src/services/auth_service.dart
Collections: `users`

### hominode-admin/admin_app/lib/.dart_backups/resident_app/lib/src/services/billing_flow_function.dart
Collections: `bills`, `users`

### hominode-admin/admin_app/lib/.dart_backups/resident_app/lib/src/services/booking_firestore_service.dart
Collections: `users`

### hominode-admin/admin_app/lib/.dart_backups/resident_app/lib/src/services/chat_firestore_service.dart
Collections: `users`

### hominode-admin/admin_app/lib/.dart_backups/resident_app/lib/src/services/complaint_firestore_service.dart
Collections: `users`

### hominode-admin/admin_app/lib/.dart_backups/resident_app/lib/src/services/complaint_image_service.dart
Collections: `complaints`

### hominode-admin/admin_app/lib/.dart_backups/resident_app/lib/src/services/events_announcements_flow_function.dart
Collections: `announcements`, `events`

### hominode-admin/admin_app/lib/.dart_backups/resident_app/lib/src/services/flat_access_control_service.dart
Collections: `users`

### hominode-admin/admin_app/lib/.dart_backups/resident_app/lib/src/services/image_display_flow_function.dart
Collections: `complaints`, `listings`, `posts`, `users`

### hominode-admin/admin_app/lib/.dart_backups/resident_app/lib/src/services/image_upload_flow_function.dart
Collections: `users`

### hominode-admin/admin_app/lib/.dart_backups/resident_app/lib/src/services/language_service.dart
Collections: `users`

### hominode-admin/admin_app/lib/.dart_backups/resident_app/lib/src/services/listing_firestore_service.dart
Collections: `marketplaces`, `requests`, `users`

### hominode-admin/admin_app/lib/.dart_backups/resident_app/lib/src/services/marketplace_request_service.dart
Collections: `marketplaceRequests`, `notifications`, `users`

### hominode-admin/admin_app/lib/.dart_backups/resident_app/lib/src/services/notice_firestore_service.dart
Collections: `readBy`, `users`

### hominode-admin/admin_app/lib/.dart_backups/resident_app/lib/src/services/organization_service.dart
Collections: `admins`, `buildings`, `users`

### hominode-admin/admin_app/lib/.dart_backups/resident_app/lib/src/services/post_firestore_service.dart
Collections: `comments`, `posts`, `reports`, `users`

### hominode-admin/admin_app/lib/.dart_backups/resident_app/lib/src/services/profile_image_service.dart
Collections: `users`

### hominode-admin/admin_app/lib/.dart_backups/resident_app/lib/src/services/recent_activity_flow_function.dart
Collections: `bookings`, `complaints`, `users`, `visitors`

### hominode-admin/admin_app/lib/.dart_backups/resident_app/lib/src/services/resident_login_service.dart
Collections: `users`

### hominode-admin/admin_app/lib/.dart_backups/resident_app/lib/src/services/resident_registration_service.dart
Collections: `communities`, `communityInvites`
Callables: `registerResident`

### hominode-admin/admin_app/lib/.dart_backups/resident_app/lib/src/services/secure_auth_service.dart
Collections: `flats`, `users`

### hominode-admin/admin_app/lib/.dart_backups/resident_app/lib/src/services/tenant_resolution_service.dart
Collections: `admins`, `communities`, `users`

### hominode-admin/admin_app/lib/.dart_backups/resident_app/lib/src/services/user_data_service.dart
Collections: `users`

### hominode-admin/admin_app/lib/.dart_backups/resident_app/lib/src/services/validation_service.dart
Collections: `buildings`, `flats`, `users`

### hominode-admin/admin_app/lib/.dart_backups/resident_app/lib/src/services/visitor_firestore_service.dart
Collections: `users`

### hominode-admin/admin_app/lib/.dart_backups/resident_app/lib/test_all_fixes.dart
Collections: `users`

### hominode-admin/admin_app/lib/.dart_backups/resident_app/lib/test_amenities_advanced.dart
Collections: `amenities`, `amenityBookings`

### hominode-admin/admin_app/lib/.dart_backups/resident_app/lib/test_amenities_fetch.dart
Collections: `amenities`, `users`

### hominode-admin/admin_app/lib/.dart_backups/resident_app/lib/test_amenities_fix.dart
Collections: `amenities`, `users`

### hominode-admin/admin_app/lib/.dart_backups/resident_app/lib/test_amenities_realtime.dart
Collections: `users`

### hominode-admin/admin_app/lib/.dart_backups/resident_app/lib/test_apartment_images.dart
Collections: `apartmentImages`, `users`

### hominode-admin/admin_app/lib/.dart_backups/resident_app/lib/test_billing_debug.dart
Collections: `bills`, `users`

### hominode-admin/admin_app/lib/.dart_backups/resident_app/lib/test_billing_fetch.dart
Collections: `bills`, `flats`, `users`

### hominode-admin/admin_app/lib/.dart_backups/resident_app/lib/test_booking_availability.dart
Collections: `amenities`, `amenityBookings`

### hominode-admin/admin_app/lib/.dart_backups/resident_app/lib/test_capacity_calculation.dart
Collections: `amenityBookings`

### hominode-admin/admin_app/lib/.dart_backups/resident_app/lib/test_chat_requests_flow.dart
Collections: `chatRequests`, `chats`, `users`

### hominode-admin/admin_app/lib/.dart_backups/resident_app/lib/test_community_wall_access.dart
Collections: `posts`, `users`

### hominode-admin/admin_app/lib/.dart_backups/resident_app/lib/test_complaint_admin_access.dart
Collections: `complaints`, `users`

### hominode-admin/admin_app/lib/.dart_backups/resident_app/lib/test_complaints_fix.dart
Collections: `users`

### hominode-admin/admin_app/lib/.dart_backups/resident_app/lib/test_firebase_auth_creation.dart
Collections: `users`

### hominode-admin/admin_app/lib/.dart_backups/resident_app/lib/test_firestore_connection.dart
Collections: `test`, `users`

### hominode-admin/admin_app/lib/.dart_backups/resident_app/lib/test_login_debug.dart
Collections: `users`

### hominode-admin/admin_app/lib/.dart_backups/resident_app/lib/test_messages_debug.dart
Collections: `chats`

### hominode-admin/admin_app/lib/.dart_backups/resident_app/lib/test_notices_fetch.dart
Collections: `notices`

### hominode-admin/admin_app/lib/.dart_backups/resident_app/lib/test_visitor_admin_access.dart
Collections: `users`, `visitors`

### hominode-admin/admin_app/lib/.dart_backups/resident_app/lib/test_visitor_auth_fix.dart
Collections: `users`

### hominode-admin/admin_app/lib/.dart_backups/resident_app/lib/verify_firestore_indexes.dart
Collections: `chatRequests`, `chats`

### hominode-admin/admin_app/lib/.dart_backups/resident_app/lib/visitor_qr_screen.dart
Collections: `visitors`

### hominode-admin/admin_app/lib/admin_dashboard_page.dart
Collections: `admins`, `notifications`

### hominode-admin/admin_app/lib/complaint_management_screen.dart
Collections: `flats`, `users`

### hominode-admin/admin_app/lib/debug_admin_helper.dart
Collections: `admins`

### hominode-admin/admin_app/lib/navigation/admin_module_routes.dart
Routes: `/amenities`, `/billing`, `/buildings`, `/complaints`, `/dashboard`, `/events`, `/parking`, `/parking_management`, `/profile`, `/resident-vehicles`, `/resident_vehicles`, `/residents`, `/settings`, `/visitor_management`, `/visitors`

### hominode-admin/admin_app/lib/profile_screen.dart
Collections: `users`

### hominode-admin/admin_app/lib/resident_vehicle_registration_screen.dart
Collections: `users`

### hominode-admin/admin_app/lib/services/access_control_service.dart
Collections: `buildings`, `flats`, `users`

### hominode-admin/admin_app/lib/services/admin_notification_router.dart
Collections: `admins`, `notifications`

### hominode-admin/admin_app/lib/services/admin_registry_service.dart
Collections: `admins`
Callables: `createAdmin`, `setAdminActive`, `updateAdminAssignments`

### hominode-admin/admin_app/lib/services/admin_service.dart
Collections: `buildings`, `flats`, `users`

### hominode-admin/admin_app/lib/services/auth_service.dart
Collections: `admins`

### hominode-admin/admin_app/lib/services/billing_service.dart
Collections: `payments`, `users`
Callables: `rejectPaymentProof`, `verifyPaymentProof`

### hominode-admin/admin_app/lib/services/broadcast_service.dart
Collections: `broadcasts`, `users`

### hominode-admin/admin_app/lib/services/building_service.dart
Collections: `admins`
Callables: `createBuilding`, `deleteBuilding`, `reconcileBuilding`, `validateBuildingDeletion`

### hominode-admin/admin_app/lib/services/chat_service.dart
Collections: `users`

### hominode-admin/admin_app/lib/services/community_invite_service.dart
Callables: `createCommunity`, `createCommunityInvite`, `listCommunityInvites`, `revokeCommunityInvite`, `updateCommunityLocation`

### hominode-admin/admin_app/lib/services/community_location_service.dart
Callables: `resolveCommunityLocationPlace`, `reverseGeocodeCommunityLocation`, `searchCommunityLocations`

### hominode-admin/admin_app/lib/services/dashboard_service.dart
Collections: `bills`, `complaints`, `flats`, `users`, `visitors`

### hominode-admin/admin_app/lib/services/data_storage_diagnostic.dart
Collections: `admins`, `flats`, `users`

### hominode-admin/admin_app/lib/services/firestore_test_service.dart
Collections: `_test`, `users`

### hominode-admin/admin_app/lib/services/flat_service.dart
Collections: `admins`
Callables: `renameUnit`

### hominode-admin/admin_app/lib/services/gate_service.dart
Collections: `gates`
Callables: `deleteSecurityPlace`

### hominode-admin/admin_app/lib/services/notice_service.dart
Collections: `flats`

### hominode-admin/admin_app/lib/services/notification_firestore_service.dart
Callables: `sendNotification`

### hominode-admin/admin_app/lib/services/notification_service.dart
Collections: `notifications`

### hominode-admin/admin_app/lib/services/parking_service.dart
Collections: `users`

### hominode-admin/admin_app/lib/services/reports_service.dart
Collections: `bills`, `buildings`, `complaints`, `flats`, `parcels`

### hominode-admin/admin_app/lib/services/resident_bulk_import_service.dart
Callables: `importResidentsBulk`, `validateResidentBulkImport`

### hominode-admin/admin_app/lib/services/resident_deletion_service.dart
Collections: `amenity_bookings`, `complaints`, `flats`, `messages`, `notifications`, `users`, `visitors`

### hominode-admin/admin_app/lib/services/resident_service.dart
Collections: `flats`
Callables: `approveResidentRegistration`, `assignResidentOnboardingToFlat`, `cancelResidentOnboardingReservation`, `createResidentOnboarding`, `deactivateResident`, `getResidentIdentityProofUrl`, `listAssignableResidentOnboardings`, `moveOutResident`, `reactivateResident`, `reassignResident`, `rejectResidentRegistration`, `reviewResidentIdentityProof`

### hominode-admin/admin_app/lib/services/security_service.dart
Callables: `assignSecurityWork`, `createSecurityStaff`, `removeSecurityAssignment`

### hominode-admin/admin_app/lib/services/staff_qr_service.dart
Collections: `securityStaff`, `staff`, `staffAttendance`

### hominode-admin/admin_app/lib/services/staff_vendor_service.dart
Collections: `securityStaff`

### hominode-admin/admin_app/lib/services/tenant_registry_service.dart
Collections: `communities`
Callables: `createCommunity`, `setCommunityActive`, `updateCommunity`

### hominode-admin/admin_app/lib/services/user_service.dart
Collections: `flats`

### hominode-admin/admin_app/lib/services/visitor_service.dart
Collections: `buildings`

### hominode-admin/admin_app/lib/widgets/create_monthly_bill_modal.dart
Collections: `buildings`, `flats`, `users`

### hominode-admin/admin_app/lib/widgets/edit_profile_modal.dart
Collections: `admins`

### resident_app/lib/src/modals/complaint_detail_modal.dart
Collections: `complaints`

### resident_app/lib/src/screens/documents_circulars_screen.dart
Collections: `documents`

### resident_app/lib/src/screens/domestic_staff_screen.dart
Collections: `domesticStaff`

### resident_app/lib/src/screens/edit_profile_screen.dart
Collections: `users`

### resident_app/lib/src/screens/marketplace_screen.dart
Routes: `/marketplace_buyer_phone_view`, `/marketplace_edit_listing`, `/marketplace_your_product_detail`

### resident_app/lib/src/screens/marketplace_screen_enhanced.dart
Routes: `/marketplace_edit_listing`, `/marketplace_your_product_detail`

### resident_app/lib/src/screens/my_bookings_screen.dart
Collections: `amenityBookings`

### resident_app/lib/src/screens/submit_payment_proof_screen.dart
Collections: `payments`

### resident_app/lib/src/services/admin_chat_service.dart
Collections: `flats`

### resident_app/lib/src/services/admin_data_service.dart
Collections: `buildings`, `complaints`, `users`, `visitors`

### resident_app/lib/src/services/admin_login_service.dart
Collections: `users`

### resident_app/lib/src/services/admin_statistics_service.dart
Collections: `bills`, `complaints`, `flats`, `users`, `visitors`

### resident_app/lib/src/services/amenities_booking_flow_function.dart
Collections: `amenities`, `bookings`, `users`

### resident_app/lib/src/services/amenities_booking_logic.dart
Collections: `amenityBookings`

### resident_app/lib/src/services/announcements_events_service.dart
Collections: `announcements`, `events`, `users`

### resident_app/lib/src/services/apartment_images_service.dart
Collections: `apartmentImages`, `users`

### resident_app/lib/src/services/auth_service.dart
Collections: `users`

### resident_app/lib/src/services/billing_flow_function.dart
Collections: `bills`, `users`

### resident_app/lib/src/services/booking_firestore_service.dart
Collections: `users`

### resident_app/lib/src/services/chat_firestore_service.dart
Collections: `users`

### resident_app/lib/src/services/complaint_firestore_service.dart
Collections: `users`

### resident_app/lib/src/services/complaint_image_service.dart
Collections: `complaints`

### resident_app/lib/src/services/events_announcements_flow_function.dart
Collections: `announcements`, `events`

### resident_app/lib/src/services/family_firestore_service.dart
Collections: `users`

### resident_app/lib/src/services/flat_access_control_service.dart
Collections: `users`

### resident_app/lib/src/services/image_display_flow_function.dart
Collections: `complaints`, `listings`, `posts`, `users`

### resident_app/lib/src/services/image_upload_flow_function.dart
Collections: `users`

### resident_app/lib/src/services/language_service.dart
Collections: `users`

### resident_app/lib/src/services/listing_firestore_service.dart
Collections: `marketplaces`, `requests`, `users`

### resident_app/lib/src/services/marketplace_request_service.dart
Collections: `marketplaceRequests`, `users`

### resident_app/lib/src/services/notice_firestore_service.dart
Collections: `readBy`, `users`
Callables: `getResidentNoticeIds`

### resident_app/lib/src/services/organization_service.dart
Collections: `admins`, `buildings`, `users`

### resident_app/lib/src/services/post_firestore_service.dart
Collections: `comments`, `posts`, `reports`, `users`

### resident_app/lib/src/services/profile_image_service.dart
Collections: `users`

### resident_app/lib/src/services/recent_activity_flow_function.dart
Collections: `bookings`, `complaints`, `users`, `visitors`

### resident_app/lib/src/services/resident_identity_service.dart
Collections: `users`
Callables: `submitResidentIdentityProof`

### resident_app/lib/src/services/resident_login_service.dart
Collections: `users`

### resident_app/lib/src/services/resident_notification_router.dart
Collections: `notifications`, `users`

### resident_app/lib/src/services/resident_registration_service.dart
Collections: `communities`, `communityInvites`
Callables: `registerResident`

### resident_app/lib/src/services/secure_auth_service.dart
Collections: `flats`, `users`

### resident_app/lib/src/services/tenant_resolution_service.dart
Collections: `communities`, `users`

### resident_app/lib/src/services/user_data_service.dart
Collections: `users`

### resident_app/lib/src/services/validation_service.dart
Collections: `buildings`, `flats`, `users`

### resident_app/lib/src/services/vehicle_firestore_service.dart
Collections: `users`

### resident_app/lib/src/services/visitor_firestore_service.dart
Collections: `users`

### packages/hominode_sos/lib/src/sos_client.dart
Collections: `sosAlerts`
Callables: `getSosContext`, `transitionSos`, `triggerSos`

### packages/hominode_notifications/lib/src/hominode_push_notifications.dart
Callables: `registerNotificationDevice`, `unregisterNotificationDevice`

## Backend callable exports
verifyPaymentProof, getSosContext, triggerSos, transitionSos, dispatchSosNotifications, rejectPaymentProof, assignSecurityWork, deleteSecurityPlace, removeSecurityAssignment, registerNotificationDevice, unregisterNotificationDevice, sendNotification, acceptCurrentLegalTerms, getResidentNoticeIds, resolveResidentCommunity, registerResident, validateResidentBulkImport, importResidentsBulk, approveResidentRegistration, rejectResidentRegistration, deactivateResident, reactivateResident, reassignResident, createResidentOnboarding, auditResidentAction, assignResidentOnboardingToFlat, cancelResidentOnboardingReservation, validateBuildingDeletion, deleteBuilding, createBuilding, reconcileBuilding, renameUnit, listAssignableResidentOnboardings, submitResidentIdentityProof, getResidentIdentityProofUrl, reviewResidentIdentityProof, moveOutResident, createCommunity, updateCommunity, setCommunityActive, searchCommunityLocations, resolveCommunityLocationPlace, reverseGeocodeCommunityLocation, updateCommunityLocation, createAdmin, updateAdminAssignments, setAdminActive, createSecurityStaff, securityCheckIn, securityCheckOut, listCommunityInvites, createCommunityInvite, revokeCommunityInvite
