export function Dashboard(){
    return (
        <div className="min-h-screen bg-gray-100 p-8">
            {/* Cabeçalho do Dashboard */}
            <div className="mb-8 flex items-center justify-between">
                <div>
                    <h1 className="text-3xl font-bold text-gray-800">Visão Geral - Ecos </h1> 
                    <p className="text-gray-500 mt-1">Monitoramento de anomalias comportamentais</p>
                </div>

                <div className="bg-blue-100 text-blue-800 px-4 py-2 rounded-lg font-semibold border border-blue-200">
                    Acesso RH
                </div>
            </div>

            {/* Grid onde vão entrar os gráficos depois :) */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">

                {/* Card de Exemplo TEMPORÁRIO*/}
                <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 col-span-2">
                    <h2 className="text-lg font-semibold mb-4 text-gray-700">Telemetria em tempo real</h2>
                    <div className="h-64 bg-gray-50 rounded border border-dashed border-gray-300 flex items-center justify-center">
                        <span className="text-gray-400">Gráfico Recharts entrará aqui</span>
                    </div>
                </div>
                {/* Card Lateral Temporário */}
                <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
                    <h2 className="text-lg font-semibold mb-4 text-gray-700">Alertas Recentes</h2>
                    <div className="space-y-3">
                        <p className="text-sm text-gray-500">Nenhuma anomalia detectada hoje.</p>
                    </div>
                </div>
            </div>
        </div>
    );
}