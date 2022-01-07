import { skillMap } from 'data/skills';
import Enemies from 'features/enemies/Enemies';
import Statistics from 'features/statistics/Statistics';
import { CSSProperties, useCallback, useEffect, useMemo, useState } from 'react';
import { costOnCharacter, recoverCost, doneCasting } from 'redux/character';
import { DamageLog, effectOnEnemy, updateEffectHistory } from 'redux/raid';
import { useAppDispatch, useAppSelector } from 'redux/store';
import { RealtimeCharacter, Skill, Effect } from 'types/types';
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

    // 产生效果
    const doEffect = useCallback((effect: Effect, skill: Skill) => {
        console.log(effect, skill);
        if (effect.target === 'self') {

        } else if (effect.target === 'enemy') {
            if (selectedTarget && !Array.isArray(selectedTarget) && selectedTarget.type === 'enemy') {
                // 计算效果数字
                const target = enemies.find(e => e.id === selectedTarget.id);
                // 增加减少
                const positiveTypes = ['heal', 'buff'];
                const pon = positiveTypes.includes(effect.type) ? 1 : -1;
                // 计算技能原始数值
                const valueFromSkill = typeof effect.value === 'number' ? effect.value : effect.value({ skill, target, caster: character! });
                // 检查暴击
                const { criticalChance, criticalDamage } = character!.enhancements;
                const [value, critical] = computeCritical(valueFromSkill, criticalChance, criticalDamage);

                // 效果形式属性
                const effected = effect.on || 'health';

                // 增加储能
                dispatch(recoverCost({
                    type: 'fury',
                    value: value * 0.01
                }))

                // 产生效果
                dispatch(effectOnEnemy({ pon, effected, targetId: selectedTarget.id, value, critical, skillId: skill.id, time, caster: character! }))
            } else {

            }
        }

    }, [character, dispatch, enemies, selectedTarget, time]);

    useEffect(() => {
        if (castingSkill) {
            // 无需读条 或 读条完成
            if (castingSkill.castTime === 0 || castingTimePast >= castingSkill.castTime) {
                // 代价
                doCost(castingSkill);
                // 效果
                castingSkill.effects.forEach((effect: Effect) => doEffect(effect, castingSkill));
                // 完成
                dispatch(doneCasting());
            }
        }
    }, [castingSkill, castingTimePast, dispatch, doCost, doEffect]);

    /**
     * 敌人释放技能
     */

    /**
     * 角色持续效果update
     */

    /**
     * 敌人持续效果update
     */

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