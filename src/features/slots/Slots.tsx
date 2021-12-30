import { useCallback, useEffect, useMemo } from "react";
import { castSkillOnEnemy } from "redux/raid";
import { addLog } from "redux/log";
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
    const skillMap: { [key: string]: Skill } = useMemo(() => {
        const data = skills.reduce((result: any, skill: Skill) => {
            result[skill.id] = skill;
            return result;
        }, {})
        return data;
    }, [skills]);

    const slotsWithSkills: Array<Slot> = useMemo(() => {
        return slots.map(slot => {
            const skill = slot.link ? skillMap[slot.link?.id] : undefined;

            const result: any = {
                ...slot
            }

            if (skill) {
                result.link = {
                    ...slot.link,
                    skill
                }
            }

            return result
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

    // const checkCost = useCallback(() => {

    // }, []);

    const doEffect = useCallback((skill: Skill) => {
        dispatch(castSkillOnEnemy({ skill, targetId: '1' }))
    }, [dispatch]);

    const onSlotClick = useCallback((slot: Slot) => {
        console.log(slot);
        if (!slot?.link) {
            console.info('no binding')
            return
        }

        if (shareCooldownRemain > 0) {
            dispatch(addLog({
                type: 'warning',
                content: 'In GCD'
            }));
            return;
        }

        const skill = skillMap[slot.link.id];
        if (skill.lastTriggerTime && time - skill.lastTriggerTime <= skill.cooldown) {
            dispatch(addLog({
                type: 'warning',
                content: '我还不能使用这个技能'
            }));
            return
        }

        doEffect(skill);
        dispatch(triggerSkillCooldown(slot.link.id));
        dispatch(triggerSharedCooldown());

    }, [dispatch, doEffect, shareCooldownRemain, skillMap, time]);

    useEffect(() => {
        const keyboardListener = (event: CustomEvent) => {
            const key: string = event.detail;
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
            let skillElement = null;
            if (link) {
                const { skill } = link
                if (skill) {
                    skillElement = <div className="slot-link">
                        {skill.icon && <img src={skill.icon} alt={skill.name} />}
                        <div className="slot-link-name">{skill.name}</div>
                    </div>

                    if (skill.lastTriggerTime && (time - skill.lastTriggerTime < skill.cooldown)) {
                        cd = time - skill.lastTriggerTime;
                        total = skill.cooldown;
                    }
                }
            } else {
                cd = shareCooldownRemain;
                total = sharedCooldown;
            }
            return <div className="slot" key={index} onClick={() => onSlotClick(slot)}>
                <Cooldown value={cd} total={total} ></Cooldown>
                <div className="slot-key">
                    {key}
                </div>
                {skillElement}
            </div>
        })}
    </div>
}

export default Slots;