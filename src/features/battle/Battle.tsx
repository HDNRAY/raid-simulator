import { skillMap } from 'data/skills';
import Enemies from 'features/enemies/Enemies';
import Statistics from 'features/statistics/Statistics';
import { CSSProperties, useCallback, useEffect, useMemo, useState } from 'react';
import { costOnCharacter, recoverCost, doneCasting, addCharacterOverTimeEffect, updateCharacterOverTimeEffect, removeCharacterOverTimeEffect } from 'redux/character';
import { addLog } from 'redux/log';
import { addEnemyOverTimeEffect, DamageLog, effectOnEnemy, removeEnemyOverTimeEffect, updateEffectHistory, updateEnemyOverTimeEffect } from 'redux/raid';
import { useAppDispatch, useAppSelector } from 'redux/store';
import { RealtimeCharacter, Skill, Effect, RealtimeCharacterObject, OverTimeEffect, TargetType } from 'types/types';
import { computeCritical } from 'util/utils';
import './Battle.scss';

const BattleMessage = (props: {
    type?: string,
    duration?: number,
    content: string,
    onRemove: any,
    id: string,
    startTime: number
}) => {
    const { content, onRemove, id, startTime, duration = 4000 } = props;

    const time = useAppSelector(state => state.universal.time);

    useEffect(() => {
        if (time > startTime + duration) {
            onRemove(id);
        }
    }, [duration, id, onRemove, startTime, time])

    const style: CSSProperties = {
        opacity: (startTime + duration - time) / duration,
        top: `${100 * (time - startTime) / duration}%`
    }

    return <div className='battle-message' style={style}>
        {content}
    </div>
}

const BattleScene = (props: {
    className: string
}) => {
    const { className } = props;
    const dispatch = useAppDispatch();

    const time = useAppSelector(state => state.universal.time);

    // 战斗文字
    const effectHistory = useAppSelector(state => state.raid.effectHistory);
    const [messages, setMessages] = useState<Array<DamageLog>>([])
    useEffect(() => {
        const toUpdates = effectHistory.filter(i => i.shown === false);
        setMessages(toUpdates);
    }, [effectHistory])
    const removeById = useCallback((id: string) => {
        dispatch(updateEffectHistory({
            id, shown: true
        }))
    }, [dispatch])

    // 敌人
    const enemies = useAppSelector(state => state.raid.enemies);

    // 角色
    const character: RealtimeCharacter | undefined = useAppSelector(state => state.character.mainCharacter);

    /**
     * 公共方法
     */

    /**
     * 角色使用技能
     */
    const selectedTarget = useAppSelector(state => state.character.target);
    const castingSkill: any = useMemo(() => character?.castingSkillId && skillMap[character.castingSkillId], [character]);
    // 读条时间
    const castingTimePast = character?.castingTime ? time - character?.castingTime : 0;

    // 消耗代价
    const doCost = useCallback((skill: Skill) => {
        skill.cost.forEach(c => {
            const value = typeof c.value === 'number' ? c.value : c.value({
                caster: character!,
                skill
            });
            dispatch(costOnCharacter({ type: c.type, value }))
        })
    }, [character, dispatch]);

    // 造成直接效果
    const doDirectEffect = useCallback((effect, skill: Skill, targetType: TargetType, target: RealtimeCharacterObject, caster: RealtimeCharacterObject) => {
        // 计算效果数字
        // 增加减少
        const positiveTypes = ['heal', 'buff'];
        const pon = positiveTypes.includes(effect.type) ? 1 : -1;
        // 计算技能原始数值
        const valueFromSkill = typeof effect.value === 'number' ? effect.value : effect.value({ skill, target, caster });
        // 检查暴击
        const { criticalChance, criticalDamage } = caster.enhancements;
        const [value, critical] = computeCritical(valueFromSkill, criticalChance, criticalDamage);

        // 效果形式属性
        const effected = effect.on || 'health';

        // 增加储能
        dispatch(recoverCost({
            type: 'fury',
            value: value * 0.01
        }))

        // 产生效果
        if (targetType === 'enemy') {
            dispatch(effectOnEnemy({ pon, effected, targetId: target.id, value, critical, skillId: skill.id, time, caster }))
        }
    }, [dispatch, time]);

    // 造成持续效果
    const doOverTimeEffect = useCallback((effect: OverTimeEffect, skill, targetType: TargetType, target: RealtimeCharacterObject, caster: RealtimeCharacterObject) => {
        if (targetType === 'enemy') {
            dispatch(addEnemyOverTimeEffect({
                targetId: target.id,
                effectId: effect.id,
                skillId: skill.id,
                interval: effect.interval,
                startTime: time,
                caster
            }))
        } else if (targetType === 'self') {
            dispatch(addCharacterOverTimeEffect({
                effectId: effect.id,
                skillId: skill.id,
                startTime: time,
                caster
            }))
        }
    }, [dispatch, time]);

    // 产生效果
    const doEffect = useCallback((effect: Effect, skill: Skill, caster: RealtimeCharacterObject) => {
        // 目标
        if (!selectedTarget) {
            // 默认自动自我施法，若目标非自己，则无效
            if (effect.target !== 'self') {
                dispatch(addLog({
                    type: 'warning',
                    content: '请选择目标',
                    time
                }))
                return;
            }
        }

        let target: any;
        if (effect.target === 'self') {
            target = caster;
        } else if (effect.target === 'enemy') {
            if (selectedTarget && !Array.isArray(selectedTarget) && selectedTarget.type === 'enemy') {
                target = enemies.find(e => e.id === selectedTarget.id);
            } else {
                dispatch(addLog({
                    type: 'warning',
                    content: '无效的目标',
                    time
                }))
            }
        }

        // 效果类型
        if (['damage', 'heal'].includes(effect.type)) {
            doDirectEffect(effect, skill, effect.target, target, caster);
        } else if (['dot', 'hot', 'buff', 'debuff'].includes(effect.type)) {
            doOverTimeEffect(effect as OverTimeEffect, skill, effect.target, target, caster)
        }

    }, [dispatch, doDirectEffect, doOverTimeEffect, enemies, selectedTarget, time]);

    useEffect(() => {
        // 有施法技能
        if (castingSkill) {
            // 无需读条 或 读条完成
            if (castingSkill.castTime === 0 || castingTimePast >= castingSkill.castTime) {
                // 代价
                doCost(castingSkill);
                // 效果
                castingSkill.effects.forEach((effect: Effect) => doEffect(effect, castingSkill, character!));
                // 完成
                dispatch(doneCasting());
            }
        }
    }, [castingSkill, castingTimePast, character, dispatch, doCost, doEffect]);

    /**
     * 敌人释放技能
     */

    /**
     * 角色持续效果update
     */
    useEffect(() => {

        character?.overTimeEffects.forEach(item => {
            const { skillId, effectId, startTime, lastTriggerTime, caster } = item;
            const skill = skillMap[skillId];
            const effect: OverTimeEffect = skill.effects.find(i => i.id === effectId) as OverTimeEffect;

            if (['dot', 'hot'].includes(effect.type)) {
                if (time > lastTriggerTime + effect.interval) {
                    doDirectEffect(effect, skill, 'self', character, caster)

                    if (time < startTime + effect.duration) {
                        // 继续
                        dispatch(updateCharacterOverTimeEffect({
                            skillId: skill.id,
                            effectId: effect.id,
                            time
                        }));
                    } else {
                        // 结束
                        dispatch(removeCharacterOverTimeEffect({
                            effectId: effect.id
                        }));
                    }
                }
            } else if (['buff', 'debuff'].includes(effect.type)) {
                if (time >= startTime + effect.duration) {
                    // 结束
                    dispatch(removeCharacterOverTimeEffect({
                        effectId: effect.id
                    }));
                }
            }
        })
    }, [character, dispatch, doDirectEffect, time])

    /**
     * 敌人持续效果update
     */
    useEffect(() => {
        enemies.forEach(enemy => {
            enemy.overTimeEffects.forEach(item => {
                const { skillId, effectId, startTime, lastTriggerTime, caster } = item;
                const skill = skillMap[skillId];
                const effect: OverTimeEffect = skill.effects.find(i => i.id === effectId) as OverTimeEffect;

                if (['dot', 'hot'].includes(effect.type)) {
                    if (time > lastTriggerTime + effect.interval) {
                        doDirectEffect(effect, skill, 'enemy', enemy, caster)

                        if (time < startTime + effect.duration) {
                            // 继续
                            dispatch(updateEnemyOverTimeEffect({
                                skillId: skill.id,
                                targetId: enemy.id,
                                effectId: effect.id,
                                time
                            }));
                        } else {
                            // 结束
                            dispatch(removeEnemyOverTimeEffect({
                                targetId: enemy.id,
                                effectId: effect.id
                            }));
                        }
                    }
                } else if (['buff', 'debuff'].includes(effect.type)) {
                    if (time >= startTime + effect.duration) {
                        // 结束
                        dispatch(removeEnemyOverTimeEffect({
                            targetId: enemy.id,
                            effectId: effect.id
                        }));
                    }
                }
            })
        })
    }, [dispatch, doDirectEffect, enemies, time])

    return <div className={`battle-scene-wrapper ${className}`}>
        <Enemies className="battle-enemies"></Enemies>
        <Statistics className='battle-statistics'></Statistics>
        <div className='battle-messages-wrapper'>
            {messages.map(message => {
                const { id, value, time } = message
                return <BattleMessage key={id} id={id} content={`${value}`} onRemove={removeById} startTime={time}></BattleMessage>
            })}
        </div>
    </div>
}

export default BattleScene;