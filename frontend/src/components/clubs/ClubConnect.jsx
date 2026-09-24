import { CalendarClock, ExternalLink, Globe, Mail, MapPin, Phone } from "lucide-react";
import { Card } from "../ui";
import { activeSocialLinks, displayUrl } from "../../lib/clubLinks";
import { SocialIcon } from "./SocialIcon";

const external = { target: "_blank", rel: "noopener noreferrer" };

// Compact row of brand icons (used in the club header).
export const ClubSocialRow = ({ club, className = "" }) => {
    const links = activeSocialLinks(club);
    if (!links.length && !club.website) {
        return null;
    }
    return (
        <div className={`social-row ${className}`}>
            {club.website && (
                <a href={club.website} className="social-btn social-website" {...external}>
                    <Globe size={15} /> Website
                </a>
            )}
            {links.map((platform) => (
                <a
                    key={platform.key}
                    href={club.socialLinks[platform.key]}
                    className={`social-btn social-icon-only social-${platform.key}`}
                    aria-label={`${club.name} on ${platform.label}`}
                    title={platform.label}
                    {...external}
                >
                    <SocialIcon platform={platform.key} size={16} />
                </a>
            ))}
        </div>
    );
};

const Item = ({ icon: Icon, label, children }) => (
    <div>
        <Icon size={16} />
        <span>
            <dt>{label}</dt>
            <dd>{children}</dd>
        </span>
    </div>
);

// "Connect" card on the club's About tab: every way to reach or follow the club.
export const ClubConnectCard = ({ club }) => {
    const socials = activeSocialLinks(club);
    const hasContact = club.website || club.contactEmail || club.contactPhone;
    const hasMeetings = club.meetingSchedule || club.meetingLocation;

    if (!hasContact && !hasMeetings && !socials.length) {
        return null;
    }

    return (
        <Card title="Connect">
            <div className="stack">
                {(hasContact || hasMeetings) && (
                    <dl className="meta-list">
                        {club.website && (
                            <Item icon={Globe} label="Website">
                                <a href={club.website} className="break-anywhere" {...external}>
                                    {displayUrl(club.website)} <ExternalLink size={12} style={{ verticalAlign: "-1px" }} />
                                </a>
                            </Item>
                        )}
                        {club.contactEmail && (
                            <Item icon={Mail} label="Email">
                                <a href={`mailto:${club.contactEmail}`} className="break-anywhere">
                                    {club.contactEmail}
                                </a>
                            </Item>
                        )}
                        {club.contactPhone && (
                            <Item icon={Phone} label="Phone">
                                <a href={`tel:${club.contactPhone.replace(/[^\d+]/g, "")}`}>{club.contactPhone}</a>
                            </Item>
                        )}
                        {club.meetingSchedule && (
                            <Item icon={CalendarClock} label="Meets">
                                {club.meetingSchedule}
                            </Item>
                        )}
                        {club.meetingLocation && (
                            <Item icon={MapPin} label="Where">
                                {club.meetingLocation}
                            </Item>
                        )}
                    </dl>
                )}
                {socials.length > 0 && (
                    <div className="stack-sm">
                        <div className="section-title">Follow</div>
                        <div className="social-list">
                            {socials.map((platform) => (
                                <a key={platform.key} href={club.socialLinks[platform.key]} className={`social-link social-${platform.key}`} {...external}>
                                    <span className="social-link-icon">
                                        <SocialIcon platform={platform.key} size={16} />
                                    </span>
                                    <span className="social-link-text">
                                        <strong>{platform.label}</strong>
                                        <small>{displayUrl(club.socialLinks[platform.key])}</small>
                                    </span>
                                    <ExternalLink size={13} className="subtle" />
                                </a>
                            ))}
                        </div>
                    </div>
                )}
            </div>
        </Card>
    );
};
