import { useCallback, useEffect, useMemo } from "react";
import { addLog } from "redux/log";
import eventBus from "util/eventBus";
import Cooldown from "../../components/basic/cooldown/Cooldown";
import { triggerSharedCooldown } from "../../redux/slots";
import { useAppDispatch, useAppSelector } from "../../redux/store";
import './Slots.scss';
import { startCasting, triggerSkillCooldown } from "redux/character";
import { CharacterSkill, Skill, Slot } from "types/types";
import { skillMap } from "data/skills";

const Slots = (props: {
    className?: string
}) => {
    const { className } = props;

    const dispatch = useAppDispatch();

    // 角色
    const resources = useAppSelector(state => state.character.mainCharacter?.resources);
    const enhancements = useAppSelector(state => state.character.mainCharacter?.enhancements);

    const slots = useAppSelector(state => state.slots.slots);

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
    }, [slots])
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

    const castingSkillId = useAppSelector(state => state.character.mainCharacter?.castingSkillId);
    const castingSkill = useMemo(() => castingSkillId && skillMap[castingSkillId], [castingSkillId]);
    const characterSkills = useAppSelector(state => state.character.mainCharacter?.skills);
    const characterSkillMap: { [key: string]: CharacterSkill } = useMemo(() => characterSkills?.reduce((result: any, item) => {
        result[item.skillId] = item;
        return result;
    }, {}), [characterSkills])

    const onSkillCast = useCallback((skill: Skill) => {
        const characterSkill = characterSkillMap[skill.id];
        // 检查GCD
        if (shareCooldownRemain > 0) {
            dispatch(addLog({ type: 'warning', content: 'In GCD', time }));
            return;
        }

        // 检查技能CD
        if (characterSkill.lastTriggerTime && time - characterSkill.lastTriggerTime <= skill.cooldown) {
            dispatch(addLog({ type: 'warning', content: '我还不能使用这个技能', time }));
            return
        }

        // 是否正在施法
        if (castingSkill) {
            dispatch(addLog({ type: 'warning', content: '我正在施法', time }));
            return
        }

        // 检查代价是否足够
        const costEnough = skill.cost.every(cost => {
            const remains = resources?.[cost.type];
            return !!remains && remains > cost.value;
        });
        if (!costEnough) {
            dispatch(addLog({ type: 'warning', content: '代价不够', time }));
            return
        }

        // 检查目标是否合法
        dispatch(startCasting({
            skillId: skill.id,
            time,
            castTime: skill.castTime * (1 - (enhancements?.haste || 0)) || 0
        }))
        dispatch(triggerSkillCooldown({ skillId: skill.id, time }));
        dispatch(triggerSharedCooldown(time));

    }, [characterSkillMap, shareCooldownRemain, time, castingSkill, dispatch, enhancements, resources]);

    const onSlotClick = useCallback((slot: Slot) => {
        console.info(slot);

        // 检查是有否绑定
        if (!slot?.link) {
            console.info('no binding')
            return
        }

        if (slot?.link.type === 'skill') {
            const skill = skillMap[slot.link.id];
            !!skill && onSkillCast(skill);
        }

    }, [onSkillCast]);

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

            let cd = shareCooldownRemain, total = sharedCooldown;
            let skillElement = null;
            if (link && link.type === 'skill') {
                const skill = skillMap[link.id];
                const characterSkill = characterSkillMap[link.id];

                skillElement = <div className="slot-link">
                    {skill.icon && <img src={skill.icon} alt={skill.name} />}
                    <div className="slot-link-name">{skill.name}</div>
                </div>

                if (characterSkill.lastTriggerTime && (time - characterSkill.lastTriggerTime < skill.cooldown)) {
                    cd = time - characterSkill.lastTriggerTime;
                    total = skill.cooldown;
                }
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