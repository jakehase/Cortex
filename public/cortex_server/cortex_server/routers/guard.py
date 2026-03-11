from fastapi import APIRouter
from cortex_server.routers.contract import contract_self_test

router = APIRouter()


@router.get('/status')
async def guard_status():
    test = await contract_self_test()
    checks = test.get('checks', {}) if isinstance(test, dict) else {}
    passed = all((v or {}).get('pass') is True for v in checks.values()) if checks else False
    return {
        'success': True,
        'guard_active': True,
        'checks_total': len(checks),
        'checks_passed': sum(1 for v in checks.values() if (v or {}).get('pass') is True),
        'all_passed': passed,
    }


@router.get('/contracts')
async def guard_contracts():
    test = await contract_self_test()
    return {'success': True, 'contracts': test.get('checks', {})}


@router.get('/verify')
async def guard_verify():
    test = await contract_self_test()
    checks = test.get('checks', {}) if isinstance(test, dict) else {}
    passed = all((v or {}).get('pass') is True for v in checks.values()) if checks else False
    return {'success': True, 'verified': passed, 'details': checks}
