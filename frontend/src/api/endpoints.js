import { api, downloadFile, request } from "./client";

export const authApi = {
    register: (body) => api.post("/auth/register", body),
    verifyEmail: (email, code) => api.post("/auth/verify-email", { email, code }),
    resendVerification: (email) => api.post("/auth/resend-verification", { email }),
    login: (body) => api.post("/auth/login", body),
    logout: () => api.post("/auth/logout"),
    forgotPassword: (email) => api.post("/auth/forgot-password", { email }),
    verifyResetCode: (email, code) => api.post("/auth/verify-reset-code", { email, code }),
    resetPassword: (token, password) => api.post("/auth/reset-password", { token, password }),
    changePassword: (body) => api.post("/auth/change-password", body),
    me: () => api.get("/auth/me")
};

export const referenceApi = {
    departments: (query) => api.get("/admin/departments", query),
    batches: (query) => api.get("/admin/batches", query),
    venues: (query) => api.get("/venues", query),
    availableVenues: (query) => api.get("/venues/available", query)
};

export const userApi = {
    list: (query) => api.get("/users", query),
    search: (q, accountType, departments) => api.get("/users/search", { q, accountType, departments }),
    update: (id, body) => api.put(`/users/${id}`, body),
    // Anyone's public profile: no email, mobile number or schedule.
    profile: (id) => api.get(`/users/${id}/profile`),
    people: (q, department) => api.get("/users/people", { q, department }),
    downloadRecord: () => downloadFile("/users/me/record.pdf", "participation_record.pdf"),
    setStatus: (id, isActive) => api.patch(`/users/${id}/status`, { isActive })
};

export const dashboardApi = {
    get: () => api.get("/dashboard")
};

export const clubApi = {
    list: (query) => api.get("/clubs", query),
    mine: () => api.get("/clubs/mine"),
    get: (id) => api.get(`/clubs/${id}`),
    update: (id, body) => api.put(`/clubs/${id}`, body),
    setStatus: (id, status, reason) => api.post(`/clubs/${id}/status`, { status, reason }),
    setMentor: (id, mentorId) => api.put(`/clubs/${id}/mentor`, { mentorId }),
    assignPresident: (id, userId) => api.post(`/clubs/${id}/president`, { userId }),
    members: (id) => api.get(`/clubs/${id}/members`),
    addMember: (id, userId) => api.post(`/clubs/${id}/members`, { userId }),
    removeMember: (id, userId) => api.delete(`/clubs/${id}/members/${userId}`),
    changeRole: (id, userId, role) => api.patch(`/clubs/${id}/members/${userId}/role`, { role }),
    roles: (id) => api.get(`/clubs/${id}/roles`),
    createRole: (id, body) => api.post(`/clubs/${id}/roles`, body),
    updateRole: (id, key, body) => api.put(`/clubs/${id}/roles/${key}`, body),
    deleteRole: (id, key) => api.delete(`/clubs/${id}/roles/${key}`),
    transferPresidency: (id, userId) => api.post(`/clubs/${id}/president/transfer`, { userId }),
    leave: (id) => api.post(`/clubs/${id}/leave`),
    events: (id, query) => api.get(`/clubs/${id}/events`, query),
    subscription: (id) => api.get(`/clubs/${id}/subscription`),
    setSubscription: (id, enabled) => api.put(`/clubs/${id}/subscription`, { enabled })
};

export const clubRequestApi = {
    list: (query) => api.get("/club-requests", query),
    get: (id) => api.get(`/club-requests/${id}`),
    create: (body) => api.post("/club-requests", body),
    update: (id, body) => api.put(`/club-requests/${id}`, body),
    resubmit: (id) => api.post(`/club-requests/${id}/resubmit`),
    verify: (id, comment) => api.post(`/club-requests/${id}/verify`, { comment }),
    requestChanges: (id, comment) => api.post(`/club-requests/${id}/request-changes`, { comment }),
    reject: (id, reason) => api.post(`/club-requests/${id}/reject`, { reason }),
    approve: (id) => api.post(`/club-requests/${id}/approve`)
};

// Hackathon mode for HACKATHON events.
export const hackathonApi = {
    get: (id) => api.fresh(`/events/${id}/hackathon`),
    update: (id, body) => api.put(`/events/${id}/hackathon`, body),
    addProblem: (id, body) => api.post(`/events/${id}/hackathon/problems`, body),
    updateProblem: (id, problemId, body) => api.put(`/events/${id}/hackathon/problems/${problemId}`, body),
    deleteProblem: (id, problemId) => api.delete(`/events/${id}/hackathon/problems/${problemId}`),
    addJudge: (id, userId) => api.post(`/events/${id}/hackathon/judges`, { userId }),
    removeJudge: (id, userId) => api.delete(`/events/${id}/hackathon/judges/${userId}`),
    chooseProblem: (id, problemId) => api.put(`/events/${id}/hackathon/entry/problem`, { problemId }),
    submitRepo: (id, body) => api.put(`/events/${id}/hackathon/entry/repo`, body),
    submitProject: (id, body) => api.put(`/events/${id}/hackathon/entry/project`, body),
    judging: (id) => api.fresh(`/events/${id}/hackathon/judging`),
    score: (id, entryId, body) => api.put(`/events/${id}/hackathon/judging/${entryId}`, body),
    leaderboard: (id) => api.fresh(`/events/${id}/hackathon/leaderboard`),
    draftResults: (id, body) => api.post(`/events/${id}/hackathon/results`, body)
};

export const certificateApi = {
    mine: () => api.fresh("/certificates/mine"),
    verify: (code) => api.get(`/certificates/verify/${encodeURIComponent(code)}`),
    download: (code) => downloadFile(`/certificates/${code}/pdf`, "certificate.pdf")
};

export const pushApi = {
    publicKey: () => api.get("/push/public-key"),
    subscribe: (subscription) => api.post("/push/subscribe", subscription),
    unsubscribe: (endpoint) => api.post("/push/unsubscribe", { endpoint })
};

export const eventApi = {
    list: (query) => api.get("/events", query),
    manage: (query) => api.get("/events/manage", query),
    // Every event holding time from `from` (YYYY-MM-DD) for `days` days, for planning around other clubs.
    schedule: (query) => api.get("/events/schedule", query),
    get: (id) => api.get(`/events/${id}`),
    create: (body) => api.post("/events", body),
    update: (id, body) => api.put(`/events/${id}`, body),
    submit: (id) => api.post(`/events/${id}/submit`),
    approve: (id, comment) => api.post(`/events/${id}/approve`, { comment }),
    requestChanges: (id, comment) => api.post(`/events/${id}/request-changes`, { comment }),
    reject: (id, reason) => api.post(`/events/${id}/reject`, { reason }),
    publish: (id) => api.post(`/events/${id}/publish`),
    // Changes to a published event: reviewed by the mentor, then published by the club.
    approveChanges: (id, comment) => api.post(`/events/${id}/changes/approve`, { comment }),
    requestChangesToEdit: (id, comment) => api.post(`/events/${id}/changes/request-changes`, { comment }),
    rejectChanges: (id, reason) => api.post(`/events/${id}/changes/reject`, { reason }),
    publishChanges: (id) => api.post(`/events/${id}/changes/publish`),
    discardChanges: (id) => api.delete(`/events/${id}/changes`),
    // Tickets and check-in at the door
    ticket: (id) => api.get(`/events/${id}/ticket`),
    checkIn: (id) => api.get(`/events/${id}/check-in`),
    openCheckIn: (id) => api.post(`/events/${id}/check-in/open`),
    closeCheckIn: (id) => api.post(`/events/${id}/check-in/close`),
    checkInParticipants: (id, search) => api.get(`/events/${id}/check-in/participants`, { search }),
    scanTicket: (id, body) => api.post(`/events/${id}/check-in/scan`, body),
    markAttendance: (id, registrationId, note) => api.post(`/events/${id}/check-in/attendance/${registrationId}`, { note }),
    unmarkAttendance: (id, registrationId) => api.delete(`/events/${id}/check-in/attendance/${registrationId}`),
    // Teams
    teamCandidates: (id, search) => api.get(`/events/${id}/team/candidates`, { search }),
    inviteToTeam: (id, users) => api.post(`/events/${id}/team/invites`, { users }),
    removeTeamMember: (id, userId) => api.delete(`/events/${id}/team/members/${userId}`),
    acceptTeamInvite: (id, teamId, body) => (body ? api.post(`/events/${id}/teams/${teamId}/accept`, body) : api.post(`/events/${id}/teams/${teamId}/accept`)),
    declineTeamInvite: (id, teamId) => api.post(`/events/${id}/teams/${teamId}/decline`),
    cancel: (id, reason) => api.post(`/events/${id}/cancel`, { reason }),
    complete: (id) => api.post(`/events/${id}/complete`),
    // Reminders (SEND_REMINDERS), feedback and certificates
    sendReminder: (id, kind, note) => api.post(`/events/${id}/reminders`, { kind, note }),
    feedback: (id) => api.fresh(`/events/${id}/feedback`),
    giveFeedback: (id, body) => api.put(`/events/${id}/feedback`, body),
    certificates: (id) => api.fresh(`/events/${id}/certificates`),
    register: (id, body) => api.post(`/events/${id}/register`, body),
    unregister: (id) => api.delete(`/events/${id}/register`),
    participants: (id, query) => api.get(`/events/${id}/registrations`, query),
    updateRegistrationForm: (id, body) => api.put(`/events/${id}/registration-form`, body),
    updateMyAnswers: (id, body) => api.put(`/events/${id}/register/answers`, body),
    recordExpenses: (id, body) => api.put(`/events/${id}/expenses`, body),
    removeParticipant: (id, registrationId, reason) => api.delete(`/events/${id}/registrations/${registrationId}`, { reason }),
    result: (id) => api.get(`/events/${id}/results`),
    saveResult: (id, body) => api.put(`/events/${id}/results`, body),
    publishResult: (id) => api.post(`/events/${id}/results/publish`),
    createRound: (id, body) => api.post(`/events/${id}/results/rounds`, body),
    updateRound: (id, roundId, body) => api.put(`/events/${id}/results/rounds/${roundId}`, body),
    deleteRound: (id, roundId) => api.delete(`/events/${id}/results/rounds/${roundId}`),
    publishRound: (id, roundId) => api.post(`/events/${id}/results/rounds/${roundId}/publish`),
    unpublishRound: (id, roundId) => api.post(`/events/${id}/results/rounds/${roundId}/unpublish`)
};

export const registrationApi = {
    mine: (query) => api.get("/registrations/me", query),
    invites: () => api.get("/registrations/invites")
};

export const resultApi = {
    list: (query) => api.get("/results", query)
};

export const feedApi = {
    list: (query) => api.get("/feed", query),
    create: (body) => api.post("/feed", body),
    remove: (id) => api.delete(`/feed/${id}`)
};

export const notificationApi = {
    list: (query) => api.fresh("/notifications", query),
    unreadCount: () => api.fresh("/notifications/unread-count"),
    markRead: (id) => api.patch(`/notifications/${id}/read`),
    markAllRead: () => api.post("/notifications/read-all"),
    preferences: () => api.get("/notifications/preferences"),
    updatePreferences: (body) => api.put("/notifications/preferences", body),
    subscriptions: () => api.get("/notifications/subscriptions"),
    describeUnsubscribe: (token) => api.get("/notifications/unsubscribe", { token }),
    unsubscribe: (token) => api.post("/notifications/unsubscribe", { token })
};

export const uploadApi = {
    image: (file, folder) => {
        const form = new FormData();
        form.append("file", file);
        return request(`/uploads/image?folder=${encodeURIComponent(folder)}`, { method: "POST", body: form });
    }
};

export const recruitmentApi = {
    open: () => api.get("/recruitment"),
    mine: () => api.get("/recruitment/mine"),
    toReview: () => api.get("/recruitment/review"),
    forClub: (clubId) => api.get(`/clubs/${clubId}/recruitment`),
    create: (clubId, body) => api.post(`/clubs/${clubId}/recruitment`, body),
    get: (id) => api.get(`/recruitment/${id}`),
    update: (id, body) => api.put(`/recruitment/${id}`, body),
    remove: (id) => api.delete(`/recruitment/${id}`),
    submit: (id) => api.post(`/recruitment/${id}/submit`),
    approve: (id, comment) => api.post(`/recruitment/${id}/approve`, { comment }),
    requestChanges: (id, comment) => api.post(`/recruitment/${id}/request-changes`, { comment }),
    reject: (id, comment) => api.post(`/recruitment/${id}/reject`, { comment }),
    publish: (id) => api.post(`/recruitment/${id}/publish`),
    extend: (id, applicationEnd) => api.put(`/recruitment/${id}/deadline`, { applicationEnd }),
    close: (id) => api.post(`/recruitment/${id}/close`),
    cancel: (id, reason) => api.post(`/recruitment/${id}/cancel`, { reason }),
    myApplications: (id) => api.get(`/recruitment/${id}/applications/mine`),
    myApplication: (id, positionId) => api.get(`/recruitment/${id}/positions/${positionId}/application`),
    apply: (id, positionId, body) => api.post(`/recruitment/${id}/positions/${positionId}/application`, body),
    updateApplication: (id, positionId, body) => api.put(`/recruitment/${id}/positions/${positionId}/application`, body),
    withdraw: (id, positionId) => api.delete(`/recruitment/${id}/positions/${positionId}/application`),
    acceptOffer: (id, applicationId, body) => api.post(`/recruitment/${id}/applications/${applicationId}/accept`, body),
    declineOffer: (id, applicationId) => api.post(`/recruitment/${id}/applications/${applicationId}/decline`),
    uploadTickets: (id, kinds) => api.post(`/recruitment/${id}/uploads`, { kinds }),
    applications: (id, query) => api.get(`/recruitment/${id}/applications`, query),
    application: (id, applicationId) => api.get(`/recruitment/${id}/applications/${applicationId}`),
    rounds: (id, positionId) => api.get(`/recruitment/${id}/positions/${positionId}/rounds`),
    createRound: (id, positionId, body) => api.post(`/recruitment/${id}/positions/${positionId}/rounds`, body),
    scheduleRound: (id, positionId, roundId, body) => api.put(`/recruitment/${id}/positions/${positionId}/rounds/${roundId}/schedule`, body),
    moveSlot: (id, positionId, roundId, applicationId, startAt) => api.patch(`/recruitment/${id}/positions/${positionId}/rounds/${roundId}/slots/${applicationId}`, { startAt }),
    setOutcomes: (id, positionId, roundId, decisions) => api.put(`/recruitment/${id}/positions/${positionId}/rounds/${roundId}/outcomes`, { decisions }),
    publishRound: (id, positionId, roundId) => api.post(`/recruitment/${id}/positions/${positionId}/rounds/${roundId}/publish`),
    finalize: (id, positionId, body) => api.post(`/recruitment/${id}/positions/${positionId}/finalize`, body),
    offerToReserve: (id, positionId, applicationId) => api.post(`/recruitment/${id}/positions/${positionId}/offers/${applicationId}`),
    complete: (id) => api.post(`/recruitment/${id}/complete`)
};

export const galleryApi = {
    events: (query) => api.get("/gallery", query),
    list: (eventId, query) => api.get(`/events/${eventId}/gallery`, query),
    uploadTickets: (eventId, kinds) => api.post(`/events/${eventId}/gallery/uploads`, { kinds }),
    add: (eventId, media) => api.post(`/events/${eventId}/gallery`, { media }),
    approve: (eventId, ids) => api.post(`/events/${eventId}/gallery/approve`, { ids }),
    reject: (eventId, ids, reason) => api.post(`/events/${eventId}/gallery/reject`, { ids, reason }),
    remove: (eventId, mediaId) => api.delete(`/events/${eventId}/gallery/${mediaId}`)
};

// Likes on event posts ("event") and gallery photos ("media").
export const likeApi = {
    set: (type, id, liked) => api.put(`/likes/${type}/${id}`, { liked }),
    likers: (type, id) => api.fresh(`/likes/${type}/${id}`)
};

export const storyApi = {
    tray: () => api.get("/stories"),
    uploadTicket: (club, kind) => api.post("/stories/uploads", { club, kind }),
    create: (body) => api.post("/stories", body),
    view: (id) => api.post(`/stories/${id}/view`),
    like: (id, liked) => api.post(`/stories/${id}/like`, { liked }),
    viewers: (id, query) => api.get(`/stories/${id}/viewers`, query),
    remove: (id) => api.delete(`/stories/${id}`)
};

export const adminApi = {
    stats: () => api.get("/admin/stats"),
    faculty: (query) => api.get("/admin/faculty", query),
    createDepartment: (body) => api.post("/admin/departments", body),
    updateDepartment: (id, body) => api.put(`/admin/departments/${id}`, body),
    createBatch: (body) => api.post("/admin/batches", body),
    updateBatch: (id, body) => api.put(`/admin/batches/${id}`, body),
    createVenue: (body) => api.post("/venues", body),
    updateVenue: (id, body) => api.put(`/venues/${id}`, body)
};

export const systemApi = {
    health: () => api.get("/health"),
    devEmails: (to) => api.get("/dev/emails", { to })
};
