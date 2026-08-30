const clubService = require("./ClubService");

module.exports = {
    getUserClubs: clubService.getUserClubs,
    getClubMembers: clubService.getClubMembers,
    addMember: clubService.addMember,
    removeMember: clubService.removeMember
};
