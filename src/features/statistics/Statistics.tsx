import ProgressBar from "components/basic/progress-bar/ProgressBar";
import { skillMap } from "data/skills";
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
        const logMap = effectHistory.filter(i => i.caster.id === character?.id).reduce((result: any, item: DamageLog) => {
            const { skillId, value } = item;
            if (!result[skillId]) {
                result[skillId] = {
                    name: skillMap[skillId].name,
                    value: 0
                }
            }
            result[skillId].value += value;
            total += value;
            return result;
        }, {});

        const result = Object.values(logMap).filter(i => !!i).sort().reverse();

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