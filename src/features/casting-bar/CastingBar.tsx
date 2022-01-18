import ProgressBar from "components/basic/progress-bar/ProgressBar";
import { skillMap } from "data/skills";
import { useMemo } from "react";
import { useAppSelector } from "redux/store";
import { RealtimeCharacter } from "types/types";
import { getPercentage } from "util/utils";

const CastingBar = () => {

    const time = useAppSelector(state => state.universal.time);

    const character: RealtimeCharacter | undefined = useAppSelector(state => state.character.mainCharacter);
    const { castingSkillId, castingTime } = character || {} as RealtimeCharacter;

    // 正在释放技能
    const castingSkill: any = useMemo(() => castingSkillId && skillMap[castingSkillId], [castingSkillId]);
    // 读条时间
    const castingTimePast = castingTime ? time - castingTime : 0;
    // 读条百分比
    const castingPercentage = getPercentage(castingTimePast, character?.castTime);
    // 读条剩余时间
    const castingTimeRemain = castingSkill ? Math.max((character?.castTime || 0) - castingTimePast, 0) / 1000 : 0

    return <ProgressBar className="character-casting" percentage={castingPercentage} color="#eee">{castingTimeRemain.toFixed(1)}s</ProgressBar>
}

export default CastingBar