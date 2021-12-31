import { Character } from "redux/character";
import { v4 as uuid } from 'uuid';

export const you: Character = {
    id: uuid(),
    name: "张语寒",
    staticResource: {
        health: 10000,
        mana: 10000,
        energy: 120,
        fury: 0
    },
    staticAttributes: {
        strength: 100,
        agility: 100,
        intelligence: 100,
        spirit: 100
    }
}