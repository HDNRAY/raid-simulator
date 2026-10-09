import BattleScene from "features/battle/Battle"
import BuffPanel from "features/buff/BuffPanel"
import Character from "features/character/Character"
import Info from "features/info/Info"
import { useCallback, useEffect, useRef } from "react"
import { useAppDispatch } from "redux/store"
import { updateTime } from "redux/universal"
import Logs from "../logs/Logs"
import Slots from "../slots/Slots"
import './Layout.scss'
import { Routes, Route, Navigate } from 'react-router-dom'

const Layout = () => {
    const dispatch = useAppDispatch();

    const requestAnimationFrameRef = useRef<number>();

    const loop = useCallback((time: number) => {
        dispatch(updateTime(+time.toFixed(0)));
        setTimeout(() => {
            requestAnimationFrameRef.current = requestAnimationFrame(loop);
        }, 10);
    }, [dispatch])

    useEffect(() => {
        requestAnimationFrame(loop)

        return () => {
            cancelAnimationFrame(requestAnimationFrameRef.current!)
        }
    }, [loop]);

    return <div className='layout-wrapper'>
        <Info className="layout-info"></Info>
        <Logs className="layout-logs"></Logs>
        <Slots className="layout-slots"></Slots>
        <Character className="layout-character"></Character>
        <BuffPanel className="layout-buff"></BuffPanel>
        {/* <BattleScene className="layout-battle"></BattleScene> */}
        <Routes>
            <Route path='battle' element={<BattleScene className="layout-battle"></BattleScene>}></Route>
            <Route path='*' element={<Navigate to="battle"></Navigate>}></Route>
        </Routes>
    </div>
}

export default Layout