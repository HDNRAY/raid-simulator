import { useCallback, useEffect, useRef } from "react"
import { initSlots } from "redux/slots"
import { useAppDispatch } from "redux/store"
import { updateTime } from "redux/universal"
import Log from "../log/Log"
import Slots from "../slots/Slots"
import './Layout.scss'

const Layout = () => {
    const dispatch = useAppDispatch();

    const requestAnimationFrameRef = useRef<number>();

    useEffect(() => {
        dispatch(initSlots())
    }, [dispatch]);

    const loop = useCallback(() => {
        setTimeout(() => {
            dispatch(updateTime());
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
        <Log></Log>
        <Slots className="layout-slots"></Slots>
    </div>
}

export default Layout