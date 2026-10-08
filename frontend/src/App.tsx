function App() {
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
      <div className="bg-white p-8 rounded-xl shadow-lg border border-gray-100 max-w-md w-full text-center">
        <div className="mb-6 flex justify-center">
          <div className="h-16 w-16 bg-blue-100 rounded-full flex items-center justify-center">
            <svg className="w-8 h-8 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
        </div>
        <h1 className="text-2xl font-bold text-gray-800 mb-2">
          Ecos Dashboard
        </h1>
        <p className="text-gray-500 mb-6">
          Ambiente do Frontend inicializado e configurado com sucesso!
        </p>
        <span className="inline-flex px-4 py-2 bg-green-100 text-green-800 text-sm font-semibold rounded-full border border-green-200">
          Tailwind CSS Ativo
        </span>
      </div>
    </div>
  )
}

export default App