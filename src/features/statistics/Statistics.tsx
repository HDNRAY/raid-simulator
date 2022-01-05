import ProgressBar from "components/ProgressBar/ProgressBar";
import { useMemo } from "react";
import { DamageLog } from "redux/raid";
import { useAppSelector } from "redux/store";

const Statistics = (props: {
    className?: string
}) => {
    const { className } = props;

    const effectHistory = useAppSelector(state => state.raid.effectHistory);
    const character = useAppSelector(state => state.character.mainCharacter);

    const { list, total } = useMemo(() => {
        let total = 0;
        const skillMap = effectHistory.filter(i => i.caster.id === character?.id).reduce((result: any, item: DamageLog) => {
            const { skill, value } = item;
            if (!result[skill.id]) {
                result[skill.id] = {
                    name: skill.name,
                    value: 0
                }
            }
            result[skill.id].value += value;
            total += value;
            return result;
        }, {});

        const result = Object.values(skillMap).filter(i => !!i).sort().reverse();

        result.unshift({
            name: '总计',
            value: total
        })

        return { list: result, total }
    }, [character?.id, effectHistory])

    return <div className={`${className}`}>
        {list.map((item: any) => {
            const { name, value } = item;
            return <ProgressBar className="" percentage={100 * (total ? value / total : 1)} key={name} border={false}>{name}:{value}</ProgressBar>
        })}
    </div>
}

export default Statistics;