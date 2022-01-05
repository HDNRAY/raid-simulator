import Enemies from 'features/enemies/Enemies';
import Statistics from 'features/statistics/Statistics';
import { CSSProperties, useCallback, useEffect, useState } from 'react';
import { DamageLog, updateEffectHistory } from 'redux/raid';
import { useAppDispatch, useAppSelector } from 'redux/store';
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
    const dispatch = useAppDispatch();

    const { className } = props;

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