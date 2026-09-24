import { lazy, Suspense } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "./components/layout/AppShell";
import { AuthLayout } from "./components/layout/AuthLayout";
import { GuestRoute, ProtectedRoute } from "./routes/ProtectedRoute";
import { PageLoader } from "./components/ui";
import { WorkspaceProvider } from "./context/WorkspaceContext";
import { ROLES } from "./lib/constants";

const LoginPage = lazy(() => import("./pages/auth/LoginPage"));
const RegisterPage = lazy(() => import("./pages/auth/RegisterPage"));
const VerifyEmailPage = lazy(() => import("./pages/auth/VerifyEmailPage"));
const ForgotPasswordPage = lazy(() => import("./pages/auth/ForgotPasswordPage"));
const UnsubscribePage = lazy(() => import("./pages/UnsubscribePage"));
const NotificationSettingsPage = lazy(() => import("./pages/NotificationSettingsPage"));
const ResultDetailPage = lazy(() => import("./pages/ResultDetailPage"));

const DashboardPage = lazy(() => import("./pages/DashboardPage"));
const FeedPage = lazy(() => import("./pages/FeedPage"));
const NotificationsPage = lazy(() => import("./pages/NotificationsPage"));
const ProfilePage = lazy(() => import("./pages/ProfilePage"));
const ResultsPage = lazy(() => import("./pages/ResultsPage"));
const MyRegistrationsPage = lazy(() => import("./pages/MyRegistrationsPage"));
const NotFoundPage = lazy(() => import("./pages/NotFoundPage"));
const DevInboxPage = lazy(() => import("./pages/dev/DevInboxPage"));

const ClubsPage = lazy(() => import("./pages/clubs/ClubsPage"));
const ClubLayout = lazy(() => import("./pages/clubs/ClubLayout"));
const ClubAboutTab = lazy(() => import("./pages/clubs/ClubAboutTab"));
const ClubEventsTab = lazy(() => import("./pages/clubs/ClubEventsTab"));
const ClubMembersTab = lazy(() => import("./pages/clubs/ClubMembersTab"));
const ClubSettingsTab = lazy(() => import("./pages/clubs/ClubSettingsTab"));

const ClubRequestsPage = lazy(() => import("./pages/clubRequests/ClubRequestsPage"));
const ClubRequestFormPage = lazy(() => import("./pages/clubRequests/ClubRequestFormPage"));
const ClubRequestDetailPage = lazy(() => import("./pages/clubRequests/ClubRequestDetailPage"));

const EventDetailPage = lazy(() => import("./pages/events/EventDetailPage"));
const EventFormPage = lazy(() => import("./pages/events/EventFormPage"));
const ManageEventsPage = lazy(() => import("./pages/events/ManageEventsPage"));
const ParticipantsPage = lazy(() => import("./pages/events/ParticipantsPage"));
const ResultEditorPage = lazy(() => import("./pages/events/ResultEditorPage"));

const FacultyReviewsPage = lazy(() => import("./pages/faculty/FacultyReviewsPage"));
const MentoredClubsPage = lazy(() => import("./pages/faculty/MentoredClubsPage"));

const AdminOverviewPage = lazy(() => import("./pages/admin/AdminOverviewPage"));
const AdminUsersPage = lazy(() => import("./pages/admin/AdminUsersPage"));
const AdminClubsPage = lazy(() => import("./pages/admin/AdminClubsPage"));
const AdminFacultyPage = lazy(() => import("./pages/admin/AdminFacultyPage"));
const AdminAcademicsPage = lazy(() => import("./pages/admin/AdminAcademicsPage"));
const AdminVenuesPage = lazy(() => import("./pages/admin/AdminVenuesPage"));
const AdminAuditPage = lazy(() => import("./pages/admin/AdminAuditPage"));

const { STUDENT, FACULTY, ADMIN } = ROLES;

const App = () => (
    <Suspense fallback={<PageLoader />}>
        <Routes>
            <Route element={<GuestRoute />}>
                <Route element={<AuthLayout />}>
                    <Route path="/login" element={<LoginPage />} />
                    <Route path="/register" element={<RegisterPage />} />
                    <Route path="/forgot-password" element={<ForgotPasswordPage />} />
                </Route>
            </Route>
            <Route path="/dev/inbox" element={<DevInboxPage />} />
            <Route element={<AuthLayout />}>
                <Route path="/verify-email" element={<VerifyEmailPage />} />
                {/* Opened from email footers, signed in or not. */}
                <Route path="/unsubscribe" element={<UnsubscribePage />} />
                {/* Reset is now code-based; old links from earlier emails land on the new flow. */}
                <Route path="/reset-password" element={<Navigate to="/forgot-password" replace />} />
            </Route>

            <Route
                element={
                    <ProtectedRoute>
                        <WorkspaceProvider>
                            <AppShell />
                        </WorkspaceProvider>
                    </ProtectedRoute>
                }
            >
                <Route index element={<Navigate to="/dashboard" replace />} />
                <Route path="/dashboard" element={<DashboardPage />} />
                <Route path="/feed" element={<FeedPage />} />
                <Route path="/notifications" element={<NotificationsPage />} />
                <Route path="/settings/notifications" element={<NotificationSettingsPage />} />
                <Route path="/profile" element={<ProfilePage />} />
                <Route path="/results" element={<ResultsPage />} />
                <Route path="/results/:eventId" element={<ResultDetailPage />} />

                <Route path="/events" element={<Navigate to="/feed" replace />} />
                <Route path="/events/manage" element={<ManageEventsPage />} />
                <Route path="/events/create" element={<ProtectedRoute roles={[STUDENT]}><EventFormPage /></ProtectedRoute>} />
                <Route path="/events/:id" element={<EventDetailPage />} />
                <Route path="/events/:id/edit" element={<EventFormPage />} />
                <Route path="/events/:id/participants" element={<ParticipantsPage />} />
                <Route path="/events/:id/results/edit" element={<ResultEditorPage />} />

                <Route path="/clubs" element={<ClubsPage />} />
                <Route path="/clubs/:id" element={<ClubLayout />}>
                    <Route index element={<ClubAboutTab />} />
                    <Route path="events" element={<ClubEventsTab />} />
                    <Route path="members" element={<ClubMembersTab />} />
                    <Route path="settings" element={<ClubSettingsTab />} />
                </Route>

                <Route path="/club-requests" element={<ClubRequestsPage />} />
                <Route path="/club-requests/new" element={<ProtectedRoute roles={[STUDENT]}><ClubRequestFormPage /></ProtectedRoute>} />
                <Route path="/club-requests/:id" element={<ClubRequestDetailPage />} />
                <Route path="/club-requests/:id/edit" element={<ProtectedRoute roles={[STUDENT]}><ClubRequestFormPage /></ProtectedRoute>} />

                <Route path="/my-registrations" element={<ProtectedRoute roles={[STUDENT]}><MyRegistrationsPage /></ProtectedRoute>} />

                <Route element={<ProtectedRoute roles={[FACULTY]} />}>
                    <Route path="/faculty" element={<FacultyReviewsPage />} />
                    <Route path="/faculty/clubs" element={<MentoredClubsPage />} />
                </Route>

                <Route element={<ProtectedRoute roles={[ADMIN]} />}>
                    <Route path="/admin" element={<AdminOverviewPage />} />
                    <Route path="/admin/club-requests" element={<ClubRequestsPage adminView />} />
                    <Route path="/admin/clubs" element={<AdminClubsPage />} />
                    <Route path="/admin/users" element={<AdminUsersPage />} />
                    <Route path="/admin/faculty" element={<AdminFacultyPage />} />
                    <Route path="/admin/academics" element={<AdminAcademicsPage />} />
                    <Route path="/admin/venues" element={<AdminVenuesPage />} />
                    <Route path="/admin/audit" element={<AdminAuditPage />} />
                </Route>

                <Route path="*" element={<NotFoundPage />} />
            </Route>
        </Routes>
    </Suspense>
);

export default App;
