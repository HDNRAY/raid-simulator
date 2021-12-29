import { useCallback, useEffect, useMemo, useRef } from "react";
import { Skill, triggerSkillCooldown } from "redux/skill";
import eventBus from "util/eventBus";
import Cooldown from "../../components/Cooldown/Cooldown";
import { Slot, triggerSharedCooldown } from "../../redux/slots";
import { useAppDispatch, useAppSelector } from "../../redux/store";
import './Slots.scss';

const Slots = (props: {
    className?: string
}) => {
    const { className } = props;

    const dispatch = useAppDispatch();

    const slots = useAppSelector(state => state.slots.slots);
    const skills = useAppSelector(state => state.skill.skills);
    const skillMap = useMemo(() => {
        const data = skills.reduce((result: any, skill: Skill) => {
            result[skill.id] = skill;
            return result;
        }, {})
        return data;
    }, [skills]);

    const slotsWithSkills = useMemo(() => {
        return slots.map(slot => {
            const link = slot.link ? skillMap[slot.link?.id] : undefined;

            return {
                ...slot,
                link: skillMap[link?.id]
            }
        })
    }, [slots, skillMap])
    const sharedCooldownTriggerTime = useAppSelector(state => state.slots.sharedCooldownTriggerTime);
    const sharedCooldown = useAppSelector(state => state.slots.sharedCooldown);

    const time = useAppSelector(state => state.universal.time);
    const shareCooldownRemain = !sharedCooldownTriggerTime
        ? 0
        : time - sharedCooldownTriggerTime < sharedCooldown
            ? time - sharedCooldownTriggerTime
            : 0

    const keyMap = useMemo(() => {
        const _keyMap = slots.reduce((result: any, slot: Slot) => {
            if (slot.key) {
                result[slot.key.toLowerCase()] = slot;
            }
            return result;
        }, {})
        return _keyMap;
    }, [slots])

    const onSlotClick = useCallback((slot: Slot) => {
        console.log(slot);
        if (shareCooldownRemain > 0) {
            console.error('in gcd')
        } else if (slot?.link) {
            const skill = skillMap[slot.link.id];
            if (time - skill.lastTriggerTime) {
                console.error('skill in cd')
            } else {
                dispatch(triggerSkillCooldown(slot.link.id));
                dispatch(triggerSharedCooldown());
            }
        }
    }, [dispatch, shareCooldownRemain, skillMap]);

    useEffect(() => {
        const keyboardListener = (key: string) => {
            onSlotClick(keyMap[key.toLowerCase()])
        }

        eventBus.on('inner-keydown', keyboardListener)

        return () => {
            eventBus.remove('inner-keydown', keyboardListener)
        }

    }, [keyMap, onSlotClick])

    return <div className={`slots-wrapper ${className}`}>
        {slotsWithSkills.map((slot, index) => {
            const { key, link } = slot;
            let cd, total;
            if (link && link.lastTriggerTime && (time - link.lastTriggerTime < link.cd)) {
                cd = time - link.lastTriggerTime;
                total = link.cd;
            } else {
                cd = shareCooldownRemain;
                total = sharedCooldown;
            }
            return <div className="slot" key={index}>
                <Cooldown value={cd} total={total} ></Cooldown>
                <div className="slot-key">
                    {key}
                </div>
                {link ? <div className="slot-link">
                    <img src={link.icon} alt={link.name} />
                </div> : null}
            </div>
        })}
    </div>
}

export default Slots;