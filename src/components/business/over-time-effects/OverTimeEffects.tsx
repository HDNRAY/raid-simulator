import { Effect, OverTimeEffectType } from "types/types"

const OverTimeEffects = (props: {
    effects: Array<Effect<OverTimeEffectType>>
}) => {
    const { effects } = props;
    return effects.map(effect => {
        return <div key={effect.id}></div>
    })
}

export default OverTimeEffects