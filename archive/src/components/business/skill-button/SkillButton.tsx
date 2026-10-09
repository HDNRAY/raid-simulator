const SkillButton = (props: {
    skillId: string,
    cd: number,
    total: number,
    time: number
}) => {

    //     let _cd = cd, _total = total;
    //     let skillElement = null;
    //     if (link && link.type === 'skill') {
    //         const skill = skillMap[link.id];
    //         const characterSkill = characterSkillMap[link.id];

    //         skillElement = <div className="slot-link">
    //             {skill.icon && <img src={skill.icon} alt={skill.name} />}
    //             <div className="slot-link-name">{skill.name}</div>
    //         </div>

    //         if (characterSkill.lastTriggerTime && (time - characterSkill.lastTriggerTime < skill.cooldown)) {
    //             _cd = time - characterSkill.lastTriggerTime;
    //             _total = skill.cooldown;
    //         }
    //     }

    //     return <div className="slot-link">
    //                 <Cooldown value={_cd} total={_total} ></Cooldown>
    //     {skill.icon && <img src={skill.icon} alt={skill.name} />}
    //     <div className="slot-link-name">{skill.name}</div>
    // </div>
}

export default SkillButton;